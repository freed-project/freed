use std::ffi::CString;
use std::fs::File;
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, BorrowedFd, FromRawFd, OwnedFd, RawFd};
use std::os::unix::fs::{FileTypeExt, MetadataExt};

use crate::LibraryCoreStoreError;

/// One directory reached only through a duplicated inherited descriptor.
///
/// Authority operations resolve only through this open descriptor.
pub(crate) struct LibraryCoreBoundRoot {
    _descriptor: OwnedFd,
    device: u64,
    inode: u64,
    owner: u32,
    mode: u32,
}

impl LibraryCoreBoundRoot {
    pub(crate) fn from_inherited_descriptor(
        descriptor: RawFd,
    ) -> Result<Self, LibraryCoreStoreError> {
        if descriptor < 0 {
            return Err(LibraryCoreStoreError::from(
                "invalid inherited Library Core directory descriptor".to_string(),
            ));
        }
        let borrowed = unsafe { BorrowedFd::borrow_raw(descriptor) };
        let owned = borrowed
            .try_clone_to_owned()
            .map_err(LibraryCoreStoreError::from)?;
        let metadata = File::from(owned.try_clone().map_err(LibraryCoreStoreError::from)?)
            .metadata()
            .map_err(LibraryCoreStoreError::from)?;
        if !metadata.file_type().is_dir()
            || metadata.file_type().is_symlink()
            || metadata.file_type().is_socket()
        {
            return Err(LibraryCoreStoreError::from(
                "inherited Library Core descriptor is not a directory".to_string(),
            ));
        }
        Ok(Self {
            _descriptor: owned,
            device: metadata.dev(),
            inode: metadata.ino(),
            owner: metadata.uid(),
            mode: metadata.mode(),
        })
    }

    pub(crate) fn device(&self) -> u64 {
        self.device
    }

    pub(crate) fn inode(&self) -> u64 {
        self.inode
    }

    pub(crate) fn owner(&self) -> u32 {
        self.owner
    }

    pub(crate) fn descriptor(&self) -> RawFd {
        self._descriptor.as_raw_fd()
    }

    pub(crate) fn is_private_for(&self, owner: u32) -> bool {
        self.owner == owner && self.mode & 0o7777 == 0o700
    }

    pub(crate) fn open_or_create_private_directory(
        &self,
        name: &str,
    ) -> Result<OwnedFd, LibraryCoreStoreError> {
        self.open_private_directory(name, true)?.ok_or_else(|| {
            LibraryCoreStoreError::from("bound directory was not created".to_string())
        })
    }

    pub(crate) fn open_private_directory_if_present(
        &self,
        name: &str,
    ) -> Result<Option<OwnedFd>, LibraryCoreStoreError> {
        self.open_private_directory(name, false)
    }

    fn open_private_directory(
        &self,
        name: &str,
        create: bool,
    ) -> Result<Option<OwnedFd>, LibraryCoreStoreError> {
        if name.is_empty() || matches!(name, "." | "..") || name.as_bytes().contains(&b'/') {
            return Err(LibraryCoreStoreError::from(
                "invalid bound directory leaf".to_string(),
            ));
        }
        let name = CString::new(name)
            .map_err(|_| LibraryCoreStoreError::from("invalid bound directory name".to_string()))?;
        let mut descriptor = unsafe {
            libc::openat(
                self.descriptor(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        };
        if descriptor < 0
            && std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound
            && !create
        {
            return Ok(None);
        }
        if descriptor < 0
            && std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound
        {
            let created = unsafe { libc::mkdirat(self.descriptor(), name.as_ptr(), 0o700) };
            if created < 0 {
                return Err(LibraryCoreStoreError::from(
                    std::io::Error::last_os_error().to_string(),
                ));
            }
            descriptor = unsafe {
                libc::openat(
                    self.descriptor(),
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                )
            };
        }
        if descriptor < 0 {
            return Err(LibraryCoreStoreError::from(
                std::io::Error::last_os_error().to_string(),
            ));
        }
        let descriptor = unsafe { OwnedFd::from_raw_fd(descriptor) };
        let metadata = File::from(descriptor.try_clone()?)
            .metadata()
            .map_err(LibraryCoreStoreError::from)?;
        if !metadata.file_type().is_dir() || metadata.uid() != self.owner {
            return Err(LibraryCoreStoreError::from(
                "bound directory is not private".to_string(),
            ));
        }
        if metadata.mode() & 0o7777 != 0o700 {
            if unsafe { libc::fchmod(descriptor.as_raw_fd(), 0o700) } < 0 {
                return Err(std::io::Error::last_os_error().into());
            }
            let corrected = File::from(descriptor.try_clone()?).metadata()?;
            if corrected.dev() != metadata.dev()
                || corrected.ino() != metadata.ino()
                || corrected.mode() & 0o7777 != 0o700
            {
                return Err(LibraryCoreStoreError::from(
                    "bound directory is not private".to_string(),
                ));
            }
        }
        Ok(Some(descriptor))
    }

    pub(crate) fn read_bounded_private_file(
        &self,
        name: &str,
        maximum_bytes: usize,
    ) -> Result<Option<Vec<u8>>, LibraryCoreStoreError> {
        if name.is_empty()
            || matches!(name, "." | "..")
            || name.as_bytes().contains(&b'/')
            || maximum_bytes == 0
        {
            return Err(LibraryCoreStoreError::from(
                "invalid bound file request".to_string(),
            ));
        }
        let name = CString::new(name)
            .map_err(|_| LibraryCoreStoreError::from("invalid bound file name".to_string()))?;
        let descriptor = unsafe {
            libc::openat(
                self.descriptor(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        };
        if descriptor < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::NotFound {
                return Ok(None);
            }
            return Err(error.into());
        }
        let descriptor = unsafe { OwnedFd::from_raw_fd(descriptor) };
        let mut file = File::from(descriptor);
        let metadata = file.metadata()?;
        if !metadata.file_type().is_file()
            || metadata.file_type().is_symlink()
            || metadata.uid() != self.owner
            || metadata.mode() & 0o777 != 0o600
            || metadata.nlink() != 1
            || metadata.len() == 0
            || metadata.len() > maximum_bytes as u64
        {
            return Err(LibraryCoreStoreError::from(
                "bound control file is invalid".to_string(),
            ));
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.read_to_end(&mut bytes)?;
        if bytes.len() != metadata.len() as usize || bytes.len() > maximum_bytes {
            return Err(LibraryCoreStoreError::from(
                "bound control file changed while reading".to_string(),
            ));
        }
        Ok(Some(bytes))
    }

    #[allow(dead_code)]
    pub(crate) fn write_new_private_file_atomically(
        &self,
        name: &str,
        pending_name: &str,
        bytes: &[u8],
        maximum_bytes: usize,
    ) -> Result<(), LibraryCoreStoreError> {
        if name.is_empty()
            || pending_name.is_empty()
            || name == pending_name
            || matches!(name, "." | "..")
            || matches!(pending_name, "." | "..")
            || name.as_bytes().contains(&b'/')
            || pending_name.as_bytes().contains(&b'/')
            || bytes.is_empty()
            || bytes.len() > maximum_bytes
        {
            return Err(LibraryCoreStoreError::from(
                "invalid bound atomic file request".to_string(),
            ));
        }
        if let Some(existing) = self.read_bounded_private_file(name, maximum_bytes)? {
            if existing == bytes {
                return Ok(());
            }
            return Err(LibraryCoreStoreError::from(
                "bound atomic file already exists with different bytes".to_string(),
            ));
        }
        let name = CString::new(name)
            .map_err(|_| LibraryCoreStoreError::from("invalid bound file name".to_string()))?;
        let pending_name = CString::new(pending_name).map_err(|_| {
            LibraryCoreStoreError::from("invalid bound pending file name".to_string())
        })?;
        unsafe {
            libc::unlinkat(self.descriptor(), pending_name.as_ptr(), 0);
        }
        let descriptor = unsafe {
            libc::openat(
                self.descriptor(),
                pending_name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                0o600,
            )
        };
        if descriptor < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let descriptor = unsafe { OwnedFd::from_raw_fd(descriptor) };
        let mut file = File::from(descriptor);
        let write_result = (|| -> Result<(), LibraryCoreStoreError> {
            file.write_all(bytes)?;
            file.sync_all()?;
            if unsafe {
                libc::renameat(
                    self.descriptor(),
                    pending_name.as_ptr(),
                    self.descriptor(),
                    name.as_ptr(),
                )
            } < 0
            {
                return Err(std::io::Error::last_os_error().into());
            }
            let directory = file_from_duplicated_descriptor(self.descriptor())?;
            directory.sync_all()?;
            Ok(())
        })();
        if write_result.is_err() {
            unsafe {
                libc::unlinkat(self.descriptor(), pending_name.as_ptr(), 0);
            }
        }
        write_result
    }
}

pub(crate) fn file_from_duplicated_descriptor(
    descriptor: RawFd,
) -> Result<File, LibraryCoreStoreError> {
    let duplicated = unsafe { libc::fcntl(descriptor, libc::F_DUPFD_CLOEXEC, 0) };
    if duplicated < 0 {
        return Err(LibraryCoreStoreError::from(
            std::io::Error::last_os_error().to_string(),
        ));
    }
    Ok(unsafe { File::from_raw_fd(duplicated) })
}
