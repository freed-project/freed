use std::ffi::CString;
use std::fs::File;
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
        let name = CString::new(name)
            .map_err(|_| LibraryCoreStoreError::from("invalid bound directory name".to_string()))?;
        let mut descriptor = unsafe {
            libc::openat(
                self.descriptor(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        };
        if descriptor < 0 && std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound
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
        if !metadata.file_type().is_dir()
            || metadata.uid() != self.owner
            || metadata.mode() & 0o7777 != 0o700
        {
            return Err(LibraryCoreStoreError::from(
                "bound directory is not private".to_string(),
            ));
        }
        Ok(descriptor)
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
