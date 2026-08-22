use std::ffi::{CStr, CString};
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::os::fd::{AsRawFd, FromRawFd, IntoRawFd, OwnedFd};
use std::os::unix::fs::MetadataExt;

use crate::library_core_bound_root::file_from_duplicated_descriptor;
use crate::sqlite_contract_generated::{
    CONTENT_RANGE_MAXIMUM_APPEND_BYTES, CONTENT_RANGE_STORAGE_KEY_MAXIMUM_UTF8_BYTES,
    CONTENT_RANGE_STORAGE_KEY_PREFIX, CONTENT_RANGE_STORAGE_KEY_SUFFIX,
    SQLITE_LOCAL_RECONCILIATION_PROGRAMS,
};
use crate::{
    ContentCompletionReceiptV1, ContentCompletionRequestV1, ContentEvictionReceiptV1,
    ContentEvictionRequestV1, ContentRangeReadRequestV1, ContentRangeReadResponseV1,
    DurableContentRangeObjectV1, LibraryCoreStoreError,
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use sha2::{Digest, Sha256};

const RECONCILIATION_PAGE_ROWS: i64 = 128;

pub(crate) struct LibraryCoreContentVault {
    directory: OwnedFd,
    owner: u32,
}

impl LibraryCoreContentVault {
    pub(crate) fn from_directory(directory: OwnedFd) -> Result<Self, LibraryCoreStoreError> {
        let metadata = File::from(directory.try_clone()?).metadata()?;
        if !metadata.is_dir() || metadata.mode() & 0o7777 != 0o700 {
            return Err(LibraryCoreStoreError::from(
                "content vault directory is not private".to_string(),
            ));
        }
        Ok(Self {
            directory,
            owner: metadata.uid(),
        })
    }

    pub(crate) fn create_range_object_v1(
        &self,
        publication_id: &str,
        content_digest: &str,
        range_index: i64,
        range_digest: &str,
    ) -> Result<LibraryCoreContentRangeObject, LibraryCoreStoreError> {
        if !valid_digest(publication_id)
            || !valid_digest(content_digest)
            || !valid_digest(range_digest)
            || range_index < 0
        {
            return Err(LibraryCoreStoreError::from(
                "content vault range identity is invalid".to_string(),
            ));
        }
        let pending_name = c_name(&format!(".range-{publication_id}.pending"))?;
        let storage_key = content_range_storage_key(content_digest, range_index, range_digest)?;
        let storage_name = c_name(&storage_key)?;
        if leaf_exists(self.directory.as_raw_fd(), &storage_name)? {
            return Err(LibraryCoreStoreError::from(
                "content vault range object already exists".to_string(),
            ));
        }
        unsafe {
            libc::unlinkat(self.directory.as_raw_fd(), pending_name.as_ptr(), 0);
        }
        let descriptor = unsafe {
            libc::openat(
                self.directory.as_raw_fd(),
                pending_name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                0o600,
            )
        };
        if descriptor < 0 {
            return Err(io::Error::last_os_error().into());
        }
        Ok(LibraryCoreContentRangeObject {
            directory: self.directory.try_clone()?,
            file: Some(unsafe { File::from_raw_fd(descriptor) }),
            pending_name,
            published: false,
            storage_key,
            storage_name,
        })
    }

    pub(crate) fn reconcile_v1(
        &self,
        connection: &mut Connection,
    ) -> Result<(), LibraryCoreStoreError> {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        let before = transaction
            .query_row("SELECT total_changes();", [], |row| row.get::<_, i64>(0))
            .map_err(store_error)?;
        let mut physical_changed = self.reconcile_directory_entries(&transaction)?;
        let mut after_storage_key = String::new();
        loop {
            let mut statement = transaction
                .prepare(
                    "SELECT storage_key, verified_byte_length, content_digest,
                            range_index, verified_range_digest
                     FROM library_device_content_ranges
                     WHERE storage_kind = 'content_vault'
                       AND storage_key > ?1 COLLATE BINARY
                     ORDER BY storage_key COLLATE BINARY ASC LIMIT ?2;",
                )
                .map_err(store_error)?;
            let rows = statement
                .query_map(
                    rusqlite::params![after_storage_key, RECONCILIATION_PAGE_ROWS],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, String>(4)?,
                        ))
                    },
                )
                .map_err(store_error)?;
            let page = rows.collect::<Result<Vec<_>, _>>().map_err(store_error)?;
            drop(statement);
            if page.is_empty() {
                break;
            }
            for (storage_key, expected_bytes, content_digest, range_index, range_digest) in &page {
                let name = c_name(storage_key)?;
                let canonical_key =
                    content_range_storage_key(content_digest, *range_index, range_digest)?;
                if storage_key != &canonical_key
                    || !self.valid_regular_file(&name, *expected_bytes)?
                {
                    physical_changed |= self.unlink_if_present(&name)?;
                    transaction
                        .execute(
                            "DELETE FROM library_device_content_ranges
                             WHERE storage_kind = 'content_vault' AND storage_key = ?1;",
                            [storage_key],
                        )
                        .map_err(store_error)?;
                }
            }
            after_storage_key = page.last().expect("nonempty reconciliation page").0.clone();
        }
        if physical_changed {
            sync_directory(self.directory.as_raw_fd())?;
        }
        let program = SQLITE_LOCAL_RECONCILIATION_PROGRAMS
            .iter()
            .find(|program| program.0 == "content_checkpoint_reconcile_v1")
            .ok_or_else(|| {
                LibraryCoreStoreError::from(
                    "content checkpoint reconciliation program is missing".to_string(),
                )
            })?;
        transaction.execute_batch(program.1).map_err(store_error)?;
        let after = transaction
            .query_row("SELECT total_changes();", [], |row| row.get::<_, i64>(0))
            .map_err(store_error)?;
        if after > before {
            let advanced = transaction
                .execute(
                    "UPDATE library_device_content_state
                     SET revision = revision + 1
                     WHERE singleton_id = 1 AND revision < 9007199254740991;",
                    [],
                )
                .map_err(store_error)?;
            if advanced != 1 {
                return Err(LibraryCoreStoreError::from(
                    "selective content revision cannot advance".to_string(),
                ));
            }
        }
        transaction.commit().map_err(store_error)
    }

    pub(crate) fn read_range_v1(
        &self,
        connection: &Connection,
        request: &ContentRangeReadRequestV1,
    ) -> Result<ContentRangeReadResponseV1, LibraryCoreStoreError> {
        if request.schema_version != 1
            || !valid_digest(&request.content_digest)
            || request.range_index < 0
            || request.range_offset < 0
            || !(1..=i64::try_from(CONTENT_RANGE_MAXIMUM_APPEND_BYTES).expect("append bound"))
                .contains(&request.maximum_bytes)
        {
            return Err(LibraryCoreStoreError::from(
                "content range read request is invalid".to_string(),
            ));
        }
        let proof = connection
            .query_row(
                "SELECT local.verified_byte_length, local.storage_key
                 FROM library_device_content_ranges AS local
                 JOIN library_content_ranges AS canonical
                   ON canonical.content_digest = local.content_digest
                  AND canonical.range_index = local.range_index
                  AND canonical.byte_length = local.verified_byte_length
                  AND canonical.range_digest = local.verified_range_digest
                 WHERE local.content_digest = ?1 COLLATE BINARY
                   AND local.range_index = ?2
                   AND local.storage_kind = 'content_vault'
                 LIMIT 1;",
                rusqlite::params![request.content_digest, request.range_index],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(store_error)?
            .ok_or_else(|| {
                LibraryCoreStoreError::from("verified content range is unavailable".to_string())
            })?;
        if request.range_offset >= proof.0 {
            return Err(LibraryCoreStoreError::from(
                "content range read offset is outside the range".to_string(),
            ));
        }
        let name = c_name(&proof.1)?;
        let descriptor = unsafe {
            libc::openat(
                self.directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        };
        if descriptor < 0 {
            return Err(io::Error::last_os_error().into());
        }
        let mut file = unsafe { File::from_raw_fd(descriptor) };
        let metadata = file.metadata()?;
        if !metadata.is_file()
            || metadata.mode() & 0o777 != 0o600
            || metadata.uid() != self.owner
            || metadata.nlink() != 1
            || i64::try_from(metadata.len()).ok() != Some(proof.0)
        {
            return Err(LibraryCoreStoreError::from(
                "verified content range object is invalid".to_string(),
            ));
        }
        let byte_count =
            usize::try_from((proof.0 - request.range_offset).min(request.maximum_bytes)).map_err(
                |_| LibraryCoreStoreError::from("content range read length is invalid".to_string()),
            )?;
        let mut bytes = vec![0u8; byte_count];
        file.seek(SeekFrom::Start(
            u64::try_from(request.range_offset).map_err(|_| {
                LibraryCoreStoreError::from("content range read offset is invalid".to_string())
            })?,
        ))?;
        file.read_exact(&mut bytes)?;
        let next_range_offset =
            request.range_offset + i64::try_from(bytes.len()).expect("bounded read");
        Ok(ContentRangeReadResponseV1 {
            bytes,
            content_digest: request.content_digest.clone(),
            next_range_offset,
            range_complete: next_range_offset == proof.0,
            range_index: request.range_index,
            range_offset: request.range_offset,
            schema_version: 1,
        })
    }

    pub(crate) fn verify_complete_v1(
        &self,
        connection: &mut Connection,
        request: &ContentCompletionRequestV1,
    ) -> Result<ContentCompletionReceiptV1, LibraryCoreStoreError> {
        if request.schema_version != 1 || !valid_digest(&request.content_digest) {
            return Err(LibraryCoreStoreError::from(
                "content completion request is invalid".to_string(),
            ));
        }
        let range_count = connection
            .query_row(
                "SELECT range_count FROM library_blobs
                 WHERE content_digest = ?1 COLLATE BINARY
                   AND storage_layout = 'authenticated_ranges';",
                [&request.content_digest],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(store_error)?
            .ok_or_else(|| {
                LibraryCoreStoreError::from(
                    "content completion descriptor is unavailable".to_string(),
                )
            })?;
        let mut digest = Sha256::new();
        digest.update(b"freed.library-core.v1/digest-bytes/blob-content\0");
        for range_index in 0..range_count {
            let mut range_offset = 0;
            loop {
                let response = self.read_range_v1(
                    connection,
                    &ContentRangeReadRequestV1 {
                        content_digest: request.content_digest.clone(),
                        maximum_bytes: i64::try_from(CONTENT_RANGE_MAXIMUM_APPEND_BYTES)
                            .expect("append bound"),
                        range_index,
                        range_offset,
                        schema_version: 1,
                    },
                )?;
                digest.update(&response.bytes);
                range_offset = response.next_range_offset;
                if response.range_complete {
                    break;
                }
            }
        }
        if crate::lower_hex(&digest.finalize()) != request.content_digest {
            crate::selective_content::mark_content_corrupt_v1(
                connection,
                &request.content_digest,
                request.verified_at,
            )
            .map_err(|error| LibraryCoreStoreError::from(error.to_string()))?;
            return Err(LibraryCoreStoreError::from(
                "complete content digest is invalid".to_string(),
            ));
        }
        crate::selective_content::register_verified_content_completion_v1(
            connection,
            request,
            "content_vault",
        )
        .map_err(|error| LibraryCoreStoreError::from(error.to_string()))
    }

    pub(crate) fn evict_v1(
        &self,
        connection: &mut Connection,
        request: &ContentEvictionRequestV1,
    ) -> Result<ContentEvictionReceiptV1, LibraryCoreStoreError> {
        if request.schema_version != 1
            || !valid_digest(&request.content_digest)
            || request.evicted_at < 0
            || request.evicted_at > 9_007_199_254_740_991
        {
            return Err(LibraryCoreStoreError::from(
                "content eviction request is invalid".to_string(),
            ));
        }
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        let policy = transaction
            .query_row(
                "SELECT COALESCE((SELECT policy FROM library_device_content_policies
                                  WHERE content_digest = blob.content_digest), 'metadata_only')
                 FROM library_blobs AS blob
                 WHERE blob.content_digest = ?1 COLLATE BINARY;",
                [&request.content_digest],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(store_error)?
            .ok_or_else(|| {
                LibraryCoreStoreError::from(
                    "content eviction descriptor is unavailable".to_string(),
                )
            })?;
        if policy == "pinned_offline" {
            return Err(LibraryCoreStoreError::from(
                "pinned offline content must be unpinned before eviction".to_string(),
            ));
        }

        let mut after_range_index = -1i64;
        let mut evicted_ranges = 0i64;
        let mut released_bytes = 0i64;
        loop {
            let mut statement = transaction
                .prepare(
                    "SELECT range_index, verified_byte_length, storage_key
                     FROM library_device_content_ranges
                     WHERE content_digest = ?1 COLLATE BINARY
                       AND storage_kind = 'content_vault'
                       AND range_index > ?2
                     ORDER BY range_index ASC LIMIT ?3;",
                )
                .map_err(store_error)?;
            let page = statement
                .query_map(
                    rusqlite::params![
                        request.content_digest,
                        after_range_index,
                        RECONCILIATION_PAGE_ROWS
                    ],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .map_err(store_error)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(store_error)?;
            drop(statement);
            if page.is_empty() {
                break;
            }
            for (range_index, byte_length, storage_key) in &page {
                self.unlink_if_present(&c_name(storage_key)?)?;
                let deleted = transaction
                    .execute(
                        "DELETE FROM library_device_content_ranges
                         WHERE content_digest = ?1 COLLATE BINARY
                           AND range_index = ?2
                           AND storage_kind = 'content_vault'
                           AND storage_key = ?3;",
                        rusqlite::params![request.content_digest, range_index, storage_key],
                    )
                    .map_err(store_error)?;
                if deleted != 1 {
                    return Err(LibraryCoreStoreError::from(
                        "content eviction proof changed during deletion".to_string(),
                    ));
                }
                evicted_ranges = evicted_ranges.checked_add(1).ok_or_else(|| {
                    LibraryCoreStoreError::from("content eviction count overflow".to_string())
                })?;
                released_bytes = released_bytes.checked_add(*byte_length).ok_or_else(|| {
                    LibraryCoreStoreError::from("content eviction byte count overflow".to_string())
                })?;
            }
            after_range_index = page.last().expect("nonempty eviction page").0;
        }
        if evicted_ranges > 0 {
            sync_directory(self.directory.as_raw_fd())?;
            transaction
                .execute(
                    "DELETE FROM library_device_content_availability
                     WHERE content_digest = ?1 COLLATE BINARY;",
                    [&request.content_digest],
                )
                .map_err(store_error)?;
            if transaction
                .execute(
                    "UPDATE library_device_content_state SET revision = revision + 1
                     WHERE singleton_id = 1 AND revision < 9007199254740991;",
                    [],
                )
                .map_err(store_error)?
                != 1
            {
                return Err(LibraryCoreStoreError::from(
                    "selective content revision cannot advance".to_string(),
                ));
            }
        }
        let content_revision = transaction
            .query_row(
                "SELECT revision FROM library_device_content_state WHERE singleton_id = 1;",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(store_error)?;
        transaction.commit().map_err(store_error)?;
        Ok(ContentEvictionReceiptV1 {
            changed: evicted_ranges > 0,
            content_digest: request.content_digest.clone(),
            content_revision,
            evicted_ranges,
            released_bytes,
            schema_version: 1,
        })
    }

    fn reconcile_directory_entries(
        &self,
        transaction: &rusqlite::Transaction<'_>,
    ) -> Result<bool, LibraryCoreStoreError> {
        let mut physical_changed = false;
        let descriptor = self.directory.try_clone()?.into_raw_fd();
        let stream = unsafe { libc::fdopendir(descriptor) };
        if stream.is_null() {
            let error = io::Error::last_os_error();
            unsafe { libc::close(descriptor) };
            return Err(error.into());
        }
        loop {
            clear_errno();
            let entry = unsafe { libc::readdir(stream) };
            if entry.is_null() {
                let error = io::Error::last_os_error();
                unsafe { libc::closedir(stream) };
                if error.raw_os_error().unwrap_or(0) != 0 {
                    return Err(error.into());
                }
                return Ok(physical_changed);
            }
            let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) };
            if name.to_bytes() == b"." || name.to_bytes() == b".." {
                continue;
            }
            let Some(storage_key) = name.to_str().ok() else {
                physical_changed |= self.unlink_if_present(name)?;
                continue;
            };
            if storage_key.starts_with(".range-") && storage_key.ends_with(".pending") {
                physical_changed |= self.unlink_if_present(name)?;
                continue;
            }
            let expected = transaction
                .query_row(
                    "SELECT verified_byte_length, content_digest, range_index,
                            verified_range_digest
                     FROM library_device_content_ranges
                     WHERE storage_kind = 'content_vault' AND storage_key = ?1;",
                    [storage_key],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                    },
                )
                .optional()
                .map_err(store_error)?;
            let valid = match expected {
                Some((bytes, content_digest, range_index, range_digest)) => {
                    storage_key
                        == content_range_storage_key(&content_digest, range_index, &range_digest)?
                        && self.valid_regular_file(name, bytes)?
                }
                None => false,
            };
            if !valid {
                physical_changed |= self.unlink_if_present(name)?;
                transaction
                    .execute(
                        "DELETE FROM library_device_content_ranges
                         WHERE storage_kind = 'content_vault' AND storage_key = ?1;",
                        [storage_key],
                    )
                    .map_err(store_error)?;
            }
        }
    }

    fn valid_regular_file(
        &self,
        name: &CStr,
        expected_bytes: i64,
    ) -> Result<bool, LibraryCoreStoreError> {
        let mut metadata = std::mem::MaybeUninit::<libc::stat>::zeroed();
        if unsafe {
            libc::fstatat(
                self.directory.as_raw_fd(),
                name.as_ptr(),
                metadata.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } < 0
        {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::NotFound {
                return Ok(false);
            }
            return Err(error.into());
        }
        let metadata = unsafe { metadata.assume_init() };
        Ok(metadata.st_mode & libc::S_IFMT == libc::S_IFREG
            && metadata.st_mode & 0o777 == 0o600
            && metadata.st_uid == self.owner
            && metadata.st_nlink == 1
            && metadata.st_size == expected_bytes)
    }

    fn unlink_if_present(&self, name: &CStr) -> Result<bool, LibraryCoreStoreError> {
        if unsafe { libc::unlinkat(self.directory.as_raw_fd(), name.as_ptr(), 0) } < 0 {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::NotFound {
                return Ok(false);
            }
            return Err(error.into());
        }
        Ok(true)
    }
}

pub(crate) struct LibraryCoreContentRangeObject {
    directory: OwnedFd,
    file: Option<File>,
    pending_name: CString,
    published: bool,
    storage_key: String,
    storage_name: CString,
}

impl Write for LibraryCoreContentRangeObject {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.file
            .as_mut()
            .ok_or_else(|| io::Error::other("content vault object is closed"))?
            .write(bytes)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file
            .as_mut()
            .ok_or_else(|| io::Error::other("content vault object is closed"))?
            .flush()
    }
}

impl DurableContentRangeObjectV1 for LibraryCoreContentRangeObject {
    fn discard(&mut self) -> io::Result<()> {
        self.file.take();
        let name = if self.published {
            &self.storage_name
        } else {
            &self.pending_name
        };
        if unsafe { libc::unlinkat(self.directory.as_raw_fd(), name.as_ptr(), 0) } < 0 {
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::NotFound {
                return Err(error);
            }
        }
        sync_directory(self.directory.as_raw_fd())?;
        self.published = false;
        Ok(())
    }

    fn make_durable(&mut self) -> io::Result<()> {
        let file = self
            .file
            .as_mut()
            .ok_or_else(|| io::Error::other("content vault object is closed"))?;
        file.flush()?;
        file.sync_all()?;
        if leaf_exists(self.directory.as_raw_fd(), &self.storage_name)
            .map_err(|error| io::Error::other(error.to_string()))?
        {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "content vault range object already exists",
            ));
        }
        self.file.take();
        if unsafe {
            libc::renameat(
                self.directory.as_raw_fd(),
                self.pending_name.as_ptr(),
                self.directory.as_raw_fd(),
                self.storage_name.as_ptr(),
            )
        } < 0
        {
            return Err(io::Error::last_os_error());
        }
        self.published = true;
        sync_directory(self.directory.as_raw_fd())?;
        Ok(())
    }

    fn storage_key(&self) -> &str {
        &self.storage_key
    }

    fn storage_kind(&self) -> &str {
        "content_vault"
    }
}

impl Drop for LibraryCoreContentRangeObject {
    fn drop(&mut self) {
        if !self.published {
            let _ = unsafe {
                libc::unlinkat(self.directory.as_raw_fd(), self.pending_name.as_ptr(), 0)
            };
        }
    }
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn content_range_storage_key(
    content_digest: &str,
    range_index: i64,
    range_digest: &str,
) -> Result<String, LibraryCoreStoreError> {
    if !valid_digest(content_digest) || range_index < 0 || !valid_digest(range_digest) {
        return Err(LibraryCoreStoreError::from(
            "content vault range identity is invalid".to_string(),
        ));
    }
    let storage_key = format!(
        "{CONTENT_RANGE_STORAGE_KEY_PREFIX}{content_digest}-{range_index}-{range_digest}{CONTENT_RANGE_STORAGE_KEY_SUFFIX}"
    );
    if storage_key.len() > CONTENT_RANGE_STORAGE_KEY_MAXIMUM_UTF8_BYTES {
        return Err(LibraryCoreStoreError::from(
            "content vault object name exceeds its bound".to_string(),
        ));
    }
    Ok(storage_key)
}

fn c_name(value: &str) -> Result<CString, LibraryCoreStoreError> {
    if value.is_empty() || value.as_bytes().contains(&b'/') || value.len() > 255 {
        return Err(LibraryCoreStoreError::from(
            "content vault object name is invalid".to_string(),
        ));
    }
    CString::new(value).map_err(|_| {
        LibraryCoreStoreError::from("content vault object name is invalid".to_string())
    })
}

fn leaf_exists(directory: i32, name: &CString) -> Result<bool, LibraryCoreStoreError> {
    let descriptor = unsafe {
        libc::openat(
            directory,
            name.as_ptr(),
            libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
        )
    };
    if descriptor >= 0 {
        drop(unsafe { OwnedFd::from_raw_fd(descriptor) });
        return Ok(true);
    }
    let error = io::Error::last_os_error();
    if error.kind() == io::ErrorKind::NotFound {
        return Ok(false);
    }
    Err(error.into())
}

fn sync_directory(directory: i32) -> io::Result<()> {
    file_from_duplicated_descriptor(directory)
        .map_err(|error| io::Error::other(error.to_string()))?
        .sync_all()
}

fn store_error(error: rusqlite::Error) -> LibraryCoreStoreError {
    LibraryCoreStoreError::from(error.to_string())
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn clear_errno() {
    unsafe { *libc::__errno_location() = 0 };
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn clear_errno() {
    unsafe { *libc::__error() = 0 };
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    use super::*;
    use crate::install_normalized_schema_v1;

    fn fixture() -> (tempfile::TempDir, LibraryCoreContentVault, Connection) {
        let fixture = tempfile::TempDir::new().expect("content vault fixture");
        let root = fixture.path().join("vault");
        fs::create_dir(&root).expect("create content vault");
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700))
            .expect("set content vault permissions");
        let directory = OwnedFd::from(File::open(&root).expect("open content vault"));
        let vault = LibraryCoreContentVault::from_directory(directory).expect("bind content vault");
        let connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        (fixture, vault, connection)
    }

    fn insert_canonical_range(connection: &Connection, content_digest: &str) {
        connection
            .execute(
                "INSERT INTO library_blobs
                   (content_digest, byte_length, storage_layout, chunk_bytes, chunk_count,
                    range_count, range_granularity, range_index_root_digest, rendition_id,
                    cloud_availability_commitment, media_type)
                 VALUES (?1, 5, 'authenticated_ranges', 0, 0, 1, 5, ?2,
                         'original', ?3, 'application/octet-stream');",
                rusqlite::params![content_digest, "b".repeat(64), "c".repeat(64)],
            )
            .expect("content descriptor");
        connection
            .execute(
                "INSERT INTO library_content_ranges
                   (content_digest, range_index, byte_offset, byte_length, range_digest)
                 VALUES (?1, 0, 0, 5, ?2);",
                rusqlite::params![content_digest, "d".repeat(64)],
            )
            .expect("content range");
    }

    fn insert_local_range(connection: &Connection, content_digest: &str, storage_key: &str) {
        connection
            .execute(
                "INSERT INTO library_device_content_ranges
                   (content_digest, range_index, verified_byte_length,
                    verified_range_digest, storage_kind, storage_key, verified_at)
                 VALUES (?1, 0, 5, ?2, 'content_vault', ?3, 10);",
                rusqlite::params![content_digest, "d".repeat(64), storage_key],
            )
            .expect("local range");
        connection
            .execute(
                "INSERT INTO library_device_content_availability
                   (content_digest, hydration_state, verified_bytes, storage_kind,
                    complete_digest_verified_at, updated_at)
                 VALUES (?1, 'partially_cached', 5, 'content_vault', NULL, 10);",
                [content_digest],
            )
            .expect("local availability");
    }

    #[test]
    fn startup_reconciliation_preserves_exact_files_without_advancing_revision() {
        let (fixture, vault, mut connection) = fixture();
        let content_digest = "a".repeat(64);
        let storage_key = content_range_storage_key(&content_digest, 0, &"d".repeat(64))
            .expect("canonical storage key");
        insert_canonical_range(&connection, &content_digest);
        insert_local_range(&connection, &content_digest, &storage_key);
        let path = fixture.path().join("vault").join(&storage_key);
        fs::write(&path, b"12345").expect("valid range object");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .expect("valid range permissions");

        vault
            .reconcile_v1(&mut connection)
            .expect("reconcile exact vault");

        assert!(path.is_file());
        assert_eq!(
            connection
                .query_row(
                    "SELECT revision FROM library_device_content_state WHERE singleton_id = 1;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("content revision"),
            0
        );
    }

    #[test]
    fn startup_reconciliation_removes_orphans_and_missing_sqlite_proofs() {
        let (fixture, vault, mut connection) = fixture();
        let content_digest = "a".repeat(64);
        let storage_key = content_range_storage_key(&content_digest, 0, &"d".repeat(64))
            .expect("canonical storage key");
        insert_canonical_range(&connection, &content_digest);
        insert_local_range(&connection, &content_digest, &storage_key);
        for name in ["orphan.bin", ".range-dead.pending"] {
            let path = fixture.path().join("vault").join(name);
            fs::write(&path, b"orphan").expect("orphan range object");
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
                .expect("orphan range permissions");
        }

        vault
            .reconcile_v1(&mut connection)
            .expect("reconcile stale vault");

        assert!(!fixture.path().join("vault/orphan.bin").exists());
        assert!(!fixture.path().join("vault/.range-dead.pending").exists());
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_device_content_ranges;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("local range count"),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_device_content_availability;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("local availability count"),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT revision FROM library_device_content_state WHERE singleton_id = 1;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("content revision"),
            1
        );
    }
}
