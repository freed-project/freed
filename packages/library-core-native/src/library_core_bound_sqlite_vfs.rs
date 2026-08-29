//! Descriptor-relative routing for SQLite's bundled Unix VFS.
//!
//! SQLite owns its main, WAL, shared-memory, and rollback-journal opens.  The
//! stock API accepts only a filename, so a verified directory descriptor would
//! otherwise be lost before those opens.  This module installs one process-wide
//! syscall shim on the bundled Unix VFS.  Ordinary SQLite paths delegate to the
//! operating system unchanged.  Closed opaque Freed names resolve only through
//! the directory descriptor registered for that name.

use std::collections::HashMap;
use std::ffi::{CStr, CString};
use std::os::fd::{AsRawFd, FromRawFd, IntoRawFd, OwnedFd};
use std::os::raw::{c_char, c_int, c_void};
use std::os::unix::fs::{FileTypeExt, MetadataExt};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock, RwLock, Weak};

use ring::rand::{SecureRandom, SystemRandom};
use rusqlite::{ffi, Connection, OpenFlags};

use crate::LibraryCoreStorageError;

const PREFIX: &str = "/__freed_bound_v1/";
const DATABASE_FILE: &str = "library-core.sqlite";
const DATABASE_FILES: &[&str] = &[
    DATABASE_FILE,
    "library-core.sqlite-wal",
    "library-core.sqlite-shm",
    "library-core.sqlite-journal",
    "library-core.sqlite.restore-staging",
    "library-core.sqlite.pre-restore",
];

type Registry = HashMap<String, Weak<Binding>>;

static REGISTRY: OnceLock<RwLock<Registry>> = OnceLock::new();
static SHIM: OnceLock<Result<(), String>> = OnceLock::new();
#[cfg(test)]
type BeforeOpenHook = Box<dyn FnOnce() + Send>;
#[cfg(test)]
static BEFORE_BOUND_OPEN: OnceLock<std::sync::Mutex<Option<(String, BeforeOpenHook)>>> =
    OnceLock::new();

#[derive(Debug)]
struct Binding {
    token: String,
    directory: OwnedFd,
    owner: u32,
}

impl Drop for Binding {
    fn drop(&mut self) {
        if let Some(registry) = REGISTRY.get() {
            if let Ok(mut entries) = registry.write() {
                entries.remove(&self.token);
            }
        }
    }
}

/// One SQLite namespace whose files remain below an already-open directory.
#[derive(Clone, Debug)]
pub(crate) struct BoundSqliteDatabase {
    binding: Arc<Binding>,
}

impl BoundSqliteDatabase {
    pub(crate) fn from_directory(directory: OwnedFd) -> Result<Self, LibraryCoreStorageError> {
        install_shim()?;
        let metadata = std::fs::File::from(directory.try_clone()?).metadata()?;
        if !metadata.file_type().is_dir()
            || metadata.file_type().is_symlink()
            || metadata.file_type().is_socket()
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.mode() & 0o7777 != 0o700
        {
            return Err(LibraryCoreStorageError::from(
                "bound SQLite directory is not private".to_string(),
            ));
        }
        let mut random = [0_u8; 32];
        SystemRandom::new().fill(&mut random).map_err(|_| {
            LibraryCoreStorageError::from("bound SQLite token unavailable".to_string())
        })?;
        let token = crate::lower_hex(&random);
        let binding = Arc::new(Binding {
            token: token.clone(),
            directory,
            owner: metadata.uid(),
        });
        REGISTRY
            .get_or_init(|| RwLock::new(HashMap::new()))
            .write()
            .map_err(|_| {
                LibraryCoreStorageError::from("bound SQLite registry poisoned".to_string())
            })?
            .insert(token, Arc::downgrade(&binding));
        Ok(Self { binding })
    }

    pub(crate) fn logical_path(&self) -> PathBuf {
        self.logical_leaf(DATABASE_FILE)
    }

    pub(crate) fn logical_leaf(&self, leaf: &str) -> PathBuf {
        Path::new(PREFIX).join(&self.binding.token).join(leaf)
    }

    pub(crate) fn open(&self, flags: OpenFlags) -> rusqlite::Result<Connection> {
        Connection::open_with_flags_and_vfs(self.logical_path(), flags, "unix-excl")
    }

    pub(crate) fn clear_files(&self) -> Result<(), LibraryCoreStorageError> {
        for leaf in DATABASE_FILES {
            let leaf = CString::new(*leaf).expect("static SQLite leaf");
            if unsafe { libc::unlinkat(self.binding.directory.as_raw_fd(), leaf.as_ptr(), 0) } < 0 {
                let error = std::io::Error::last_os_error();
                if error.kind() != std::io::ErrorKind::NotFound {
                    return Err(error.into());
                }
            }
        }
        std::fs::File::from(self.binding.directory.try_clone()?).sync_all()?;
        Ok(())
    }
}

fn install_shim() -> Result<(), LibraryCoreStorageError> {
    SHIM.get_or_init(|| unsafe {
        let name = CString::new("unix").expect("static VFS name");
        let vfs = ffi::sqlite3_vfs_find(name.as_ptr());
        if vfs.is_null() {
            return Err("bundled Unix SQLite VFS unavailable".into());
        }
        let set = (*vfs)
            .xSetSystemCall
            .ok_or_else(|| "Unix SQLite syscall routing unavailable".to_string())?;
        for (name, function) in [
            ("open", bound_open as *mut c_void),
            ("access", bound_access as *mut c_void),
            ("stat", bound_stat as *mut c_void),
            ("lstat", bound_lstat as *mut c_void),
            ("unlink", bound_unlink as *mut c_void),
            ("openDirectory", bound_open_directory as *mut c_void),
            ("mkdir", bound_mkdir as *mut c_void),
            ("rmdir", bound_rmdir as *mut c_void),
        ] {
            let name = CString::new(name).expect("static syscall name");
            let routed = std::mem::transmute::<*mut c_void, unsafe extern "C" fn()>(function);
            let result = set(vfs, name.as_ptr(), Some(routed));
            if result != ffi::SQLITE_OK {
                return Err(format!("SQLite syscall routing failed for {name:?}"));
            }
        }
        Ok(())
    })
    .clone()
    .map_err(LibraryCoreStorageError::from)
}

enum Route {
    Ordinary,
    Bound(Arc<Binding>, String),
    Directory(Arc<Binding>),
    Reject,
}

fn resolve(path: *const c_char) -> Route {
    if path.is_null() {
        return Route::Ordinary;
    }
    let bytes = unsafe { CStr::from_ptr(path) }.to_bytes();
    if !bytes.starts_with(PREFIX.as_bytes()) {
        return Route::Ordinary;
    }
    let Ok(path) = std::str::from_utf8(bytes) else {
        return Route::Reject;
    };
    let Some(remainder) = path.strip_prefix(PREFIX) else {
        return Route::Ordinary;
    };
    let (token, leaf) = remainder
        .split_once('/')
        .map_or((remainder.trim_end_matches('/'), None), |(token, leaf)| {
            (token, Some(leaf))
        });
    if token.len() != 64
        || token
            .bytes()
            .any(|byte| !(byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)))
    {
        return Route::Reject;
    }
    if leaf.is_some_and(|leaf| !DATABASE_FILES.contains(&leaf)) {
        set_errno(libc::EINVAL);
        return Route::Reject;
    }
    let Some(binding) = REGISTRY
        .get()
        .and_then(|registry| registry.read().ok())
        .and_then(|entries| entries.get(token).cloned())
        .and_then(|binding| binding.upgrade())
    else {
        return Route::Reject;
    };
    match leaf {
        Some(leaf) => Route::Bound(binding, leaf.to_string()),
        None => Route::Directory(binding),
    }
}

unsafe extern "C" fn bound_open(path: *const c_char, flags: c_int, mode: c_int) -> c_int {
    match resolve(path) {
        Route::Bound(binding, leaf) => {
            #[cfg(test)]
            {
                let hook = {
                    let mut registered = BEFORE_BOUND_OPEN
                        .get_or_init(|| std::sync::Mutex::new(None))
                        .lock()
                        .expect("bound open hook lock");
                    if registered
                        .as_ref()
                        .is_some_and(|(token, _)| token == &binding.token)
                    {
                        registered.take().map(|(_, hook)| hook)
                    } else {
                        None
                    }
                };
                if let Some(hook) = hook {
                    hook();
                }
            }
            let leaf = match CString::new(leaf) {
                Ok(value) => value,
                Err(_) => {
                    set_errno(libc::EINVAL);
                    return -1;
                }
            };
            let descriptor = libc::openat(
                binding.directory.as_raw_fd(),
                leaf.as_ptr(),
                flags | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                mode & 0o600,
            );
            if descriptor < 0 {
                return -1;
            }
            let file = std::fs::File::from_raw_fd(descriptor);
            let Ok(metadata) = file.metadata() else {
                return -1;
            };
            if !metadata.file_type().is_file()
                || metadata.uid() != binding.owner
                || metadata.nlink() != 1
            {
                set_errno(libc::EACCES);
                return -1;
            }
            file.into_raw_fd()
        }
        Route::Reject | Route::Directory(_) => {
            set_errno(libc::EINVAL);
            -1
        }
        Route::Ordinary => libc::open(path, flags, mode),
    }
}

unsafe extern "C" fn bound_access(path: *const c_char, mode: c_int) -> c_int {
    match resolve(path) {
        Route::Bound(binding, leaf) => {
            let leaf = CString::new(leaf).expect("validated leaf");
            libc::faccessat(binding.directory.as_raw_fd(), leaf.as_ptr(), mode, 0)
        }
        Route::Directory(binding) => {
            let mut metadata = std::mem::zeroed();
            libc::fstat(binding.directory.as_raw_fd(), &mut metadata)
        }
        Route::Reject => {
            set_errno(libc::EINVAL);
            -1
        }
        Route::Ordinary => libc::access(path, mode),
    }
}

unsafe extern "C" fn bound_stat(path: *const c_char, output: *mut libc::stat) -> c_int {
    bound_stat_impl(path, output, 0, libc::stat)
}

unsafe extern "C" fn bound_lstat(path: *const c_char, output: *mut libc::stat) -> c_int {
    bound_stat_impl(path, output, libc::AT_SYMLINK_NOFOLLOW, libc::lstat)
}

unsafe fn bound_stat_impl(
    path: *const c_char,
    output: *mut libc::stat,
    flags: c_int,
    fallback: unsafe extern "C" fn(*const c_char, *mut libc::stat) -> c_int,
) -> c_int {
    match resolve(path) {
        Route::Bound(binding, leaf) => {
            let leaf = CString::new(leaf).expect("validated leaf");
            libc::fstatat(binding.directory.as_raw_fd(), leaf.as_ptr(), output, flags)
        }
        Route::Directory(binding) => libc::fstat(binding.directory.as_raw_fd(), output),
        Route::Reject => {
            set_errno(libc::EINVAL);
            -1
        }
        Route::Ordinary => fallback(path, output),
    }
}

unsafe extern "C" fn bound_unlink(path: *const c_char) -> c_int {
    match resolve(path) {
        Route::Bound(binding, leaf) => {
            let leaf = CString::new(leaf).expect("validated leaf");
            libc::unlinkat(binding.directory.as_raw_fd(), leaf.as_ptr(), 0)
        }
        Route::Reject | Route::Directory(_) => {
            set_errno(libc::EINVAL);
            -1
        }
        Route::Ordinary => libc::unlink(path),
    }
}

unsafe extern "C" fn bound_open_directory(path: *const c_char, output: *mut c_int) -> c_int {
    match resolve(path) {
        Route::Directory(binding) => {
            let descriptor = libc::fcntl(binding.directory.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0);
            if descriptor < 0 {
                return -1;
            }
            *output = descriptor;
            0
        }
        Route::Reject | Route::Bound(_, _) => {
            set_errno(libc::EINVAL);
            -1
        }
        Route::Ordinary => {
            let descriptor = libc::open(path, libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC);
            if descriptor < 0 {
                -1
            } else {
                *output = descriptor;
                0
            }
        }
    }
}

unsafe extern "C" fn bound_mkdir(path: *const c_char, mode: libc::mode_t) -> c_int {
    match resolve(path) {
        Route::Ordinary => libc::mkdir(path, mode),
        _ => {
            set_errno(libc::EPERM);
            -1
        }
    }
}

unsafe extern "C" fn bound_rmdir(path: *const c_char) -> c_int {
    match resolve(path) {
        Route::Ordinary => libc::rmdir(path),
        _ => {
            set_errno(libc::EPERM);
            -1
        }
    }
}

#[cfg(target_os = "macos")]
fn set_errno(value: c_int) {
    unsafe { *libc::__error() = value };
}

#[cfg(target_os = "linux")]
fn set_errno(value: c_int) {
    unsafe { *libc::__errno_location() = value };
}

#[cfg(test)]
mod tests {
    use std::fs::{self, File};
    use std::os::unix::fs::{symlink, OpenOptionsExt, PermissionsExt};

    use super::*;

    fn bound(directory: &Path) -> BoundSqliteDatabase {
        let file = fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
            .open(directory)
            .expect("open physical directory");
        BoundSqliteDatabase::from_directory(file.into()).expect("bind SQLite directory")
    }

    #[test]
    fn wal_database_remains_on_the_bound_inode_after_visible_replacement() {
        let fixture = tempfile::TempDir::new().expect("fixture");
        let visible = fixture.path().join("library-core");
        let moved = fixture.path().join("library-core-moved");
        let target = fixture.path().join("target");
        fs::create_dir(&visible).expect("visible directory");
        fs::create_dir(&target).expect("target directory");
        fs::set_permissions(&visible, fs::Permissions::from_mode(0o700)).expect("private mode");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o700)).expect("private target");
        fs::write(target.join("sentinel"), b"unchanged").expect("sentinel");

        let database = bound(&visible);
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
            | OpenFlags::SQLITE_OPEN_NOFOLLOW;
        let connection = database.open(flags).expect("open bound database");
        connection
            .execute_batch(
                "PRAGMA journal_mode = WAL;
                 CREATE TABLE entries(value INTEGER NOT NULL);
                 INSERT INTO entries VALUES (1);",
            )
            .expect("initialize WAL database");

        fs::rename(&visible, &moved).expect("move visible directory");
        symlink(&target, &visible).expect("replace visible directory");
        connection
            .execute("INSERT INTO entries VALUES (2);", [])
            .expect("write after replacement");
        drop(connection);

        let reopened = database.open(flags).expect("reopen bound database");
        let count: i64 = reopened
            .query_row("SELECT COUNT(*) FROM entries;", [], |row| row.get(0))
            .expect("read bound rows");
        assert_eq!(count, 2);
        assert!(moved.join(DATABASE_FILE).is_file());
        assert_eq!(
            fs::read(target.join("sentinel")).expect("sentinel"),
            b"unchanged"
        );
        assert!(!target.join(DATABASE_FILE).exists());
    }

    #[test]
    fn final_database_symlink_is_rejected_without_touching_the_target() {
        let fixture = tempfile::TempDir::new().expect("fixture");
        let directory = fixture.path().join("library-core");
        let target = fixture.path().join("target.sqlite");
        fs::create_dir(&directory).expect("directory");
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).expect("private mode");
        fs::write(&target, b"unchanged").expect("target");
        symlink(&target, directory.join(DATABASE_FILE)).expect("database symlink");

        let database = bound(&directory);
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_NOFOLLOW;
        assert!(database.open(flags).is_err());
        assert_eq!(fs::read(target).expect("target bytes"), b"unchanged");
    }

    #[test]
    fn final_leaf_swap_during_sqlite_open_cannot_redirect_the_database() {
        let fixture = tempfile::TempDir::new().expect("create SQLite race fixture");
        let directory = fixture.path().join("library-core");
        fs::create_dir(&directory).expect("create Library directory");
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .expect("set Library directory mode");
        let descriptor = File::open(&directory).expect("open Library directory");
        let database = BoundSqliteDatabase::from_directory(descriptor.into()).expect("bind SQLite");
        let connection = database
            .open(OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE)
            .expect("create source database");
        connection
            .execute("CREATE TABLE proof(value TEXT NOT NULL);", [])
            .expect("create proof table");
        drop(connection);

        let target = fixture.path().join("target.sqlite");
        fs::write(&target, b"unchanged").expect("write target");
        let source = directory.join(DATABASE_FILE);
        let moved = directory.join("moved.sqlite");
        *BEFORE_BOUND_OPEN
            .get_or_init(|| std::sync::Mutex::new(None))
            .lock()
            .expect("bound open hook lock") = Some((
            database.binding.token.clone(),
            Box::new(move || {
                fs::rename(&source, &moved).expect("move source at open boundary");
                std::os::unix::fs::symlink(&target, &source)
                    .expect("replace final leaf with symlink");
            }),
        ));

        assert!(database
            .open(OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE)
            .is_err());
        assert_eq!(
            fs::read(fixture.path().join("target.sqlite")).expect("read target"),
            b"unchanged"
        );
    }

    #[test]
    fn hardlinked_database_is_rejected_without_mutating_the_other_name() {
        let fixture = tempfile::TempDir::new().expect("create SQLite hardlink fixture");
        let directory = fixture.path().join("library-core");
        fs::create_dir(&directory).expect("create Library directory");
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .expect("set Library directory mode");
        let external = fixture.path().join("external.sqlite");
        let connection = Connection::open(&external).expect("create external SQLite database");
        connection
            .execute("CREATE TABLE sentinel(value TEXT NOT NULL);", [])
            .expect("create external sentinel table");
        drop(connection);
        fs::set_permissions(&external, fs::Permissions::from_mode(0o600))
            .expect("set external database mode");
        let original = fs::read(&external).expect("read external bytes");
        fs::hard_link(&external, directory.join(DATABASE_FILE)).expect("install database hardlink");
        let descriptor = File::open(&directory).expect("open Library directory");
        let database = BoundSqliteDatabase::from_directory(descriptor.into()).expect("bind SQLite");
        assert!(database.open(OpenFlags::SQLITE_OPEN_READ_WRITE).is_err());
        assert_eq!(fs::read(external).expect("read external bytes"), original);
    }
}
