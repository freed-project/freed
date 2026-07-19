#!/usr/bin/python3

import ctypes
import errno
import hashlib
import json
import os
import platform
import stat
import sys


PROTOCOL = "freed-lease-archive-move-v1"
MAX_PRIVATE_FILE_BYTES = 1024 * 1024
RENAME_EXCL = 0x00000004
RENAME_NOREPLACE = 0x00000001
MNT_LOCAL = 0x00001000


def fail(message, code=1):
    sys.stderr.write("lease-archive-move: " + message + "\n")
    raise SystemExit(code)


def integer(value, label):
    try:
        parsed = int(value, 10)
    except ValueError:
        fail(label + " is not an integer")
    if parsed < 0:
        fail(label + " is negative")
    return parsed


def entry_name(value, label):
    if not value or value in (".", "..") or "/" in value or "\x00" in value:
        fail(label + " is not one directory entry")
    return value


def sha256_digest(value, label):
    if len(value) != 64 or any(character not in "0123456789abcdef" for character in value):
        fail(label + " is not one lowercase SHA-256 digest")
    return value


def descriptor_digest(descriptor, expected_size, label):
    digest = hashlib.sha256()
    offset = 0
    while offset < expected_size:
        chunk = os.pread(descriptor, min(64 * 1024, expected_size - offset), offset)
        if not chunk:
            fail(label + " changed size while hashing")
        digest.update(chunk)
        offset += len(chunk)
    if os.pread(descriptor, 1, expected_size):
        fail(label + " grew while hashing")
    return digest.hexdigest()


def require_directory(descriptor, expected_device, expected_inode, label):
    try:
        value = os.fstat(descriptor)
    except OSError as error:
        fail(label + " descriptor cannot be inspected: " + error.strerror)
    if not stat.S_ISDIR(value.st_mode):
        fail(label + " descriptor is not a directory")
    if value.st_dev != expected_device or value.st_ino != expected_inode:
        fail(label + " descriptor changed generation")
    if value.st_uid != os.getuid() or stat.S_IMODE(value.st_mode) != 0o700:
        fail(label + " descriptor is not a private current-user directory")
    return value


def require_private_file(value, expected_device, expected_inode, label):
    if not stat.S_ISREG(value.st_mode):
        fail(label + " is not a regular file")
    if value.st_dev != expected_device or value.st_ino != expected_inode:
        fail(label + " changed inode generation")
    if value.st_uid != os.getuid() or stat.S_IMODE(value.st_mode) != 0o600:
        fail(label + " is not a private current-user file")
    if value.st_nlink != 1:
        fail(label + " does not have exactly one link")
    if value.st_size < 0 or value.st_size > MAX_PRIVATE_FILE_BYTES:
        fail(label + " exceeds the private file size boundary")
    return value


def lstat_at(descriptor, name):
    return os.stat(name, dir_fd=descriptor, follow_symlinks=False)


def require_absent(descriptor, name, label):
    try:
        lstat_at(descriptor, name)
    except FileNotFoundError:
        return
    except OSError as error:
        fail(label + " cannot be inspected: " + error.strerror)
    fail(label + " already exists", 17)


def native_rename_exclusive(source_name, destination_name):
    libc = ctypes.CDLL(None, use_errno=True)
    source = os.fsencode(source_name)
    destination = os.fsencode(destination_name)
    system = platform.system()
    if system == "Darwin":
        operation = getattr(libc, "renameatx_np", None)
        if operation is None:
            fail("renameatx_np is unavailable")
        operation.argtypes = [
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint,
        ]
        operation.restype = ctypes.c_int
        result = operation(3, source, 4, destination, RENAME_EXCL)
    elif system == "Linux":
        operation = getattr(libc, "renameat2", None)
        if operation is not None:
            operation.argtypes = [
                ctypes.c_int,
                ctypes.c_char_p,
                ctypes.c_int,
                ctypes.c_char_p,
                ctypes.c_uint,
            ]
            operation.restype = ctypes.c_int
            result = operation(3, source, 4, destination, RENAME_NOREPLACE)
        else:
            syscall_numbers = {"x86_64": 316, "amd64": 316, "aarch64": 276, "arm64": 276}
            syscall_number = syscall_numbers.get(platform.machine().lower())
            syscall = getattr(libc, "syscall", None)
            if syscall_number is None or syscall is None:
                fail("renameat2 is unavailable on this Linux architecture")
            syscall.restype = ctypes.c_long
            result = syscall(
                ctypes.c_long(syscall_number),
                ctypes.c_int(3),
                ctypes.c_char_p(source),
                ctypes.c_int(4),
                ctypes.c_char_p(destination),
                ctypes.c_uint(RENAME_NOREPLACE),
            )
    else:
        fail("exclusive native rename is unsupported on " + system)
    if result != 0:
        failure = ctypes.get_errno()
        if failure in (errno.EEXIST, errno.ENOTEMPTY):
            fail("archive destination already exists", 17)
        if failure in (errno.ENOSYS, errno.ENOTSUP, errno.EOPNOTSUPP):
            fail("exclusive native rename is unavailable on this filesystem")
        fail("exclusive native rename failed: " + os.strerror(failure))


def rename_generation(arguments):
    if len(arguments) != 10:
        fail("rename requires two entry names, content identity, and six generation fields")
    source_name = entry_name(arguments[0], "source name")
    destination_name = entry_name(arguments[1], "destination name")
    source_device = integer(arguments[2], "source device")
    source_inode = integer(arguments[3], "source inode")
    expected_size = integer(arguments[4], "source size")
    expected_digest = sha256_digest(arguments[5], "source digest")
    source_directory_device = integer(arguments[6], "source directory device")
    source_directory_inode = integer(arguments[7], "source directory inode")
    destination_directory_device = integer(arguments[8], "destination directory device")
    destination_directory_inode = integer(arguments[9], "destination directory inode")
    require_directory(3, source_directory_device, source_directory_inode, "source directory")
    require_directory(4, destination_directory_device, destination_directory_inode, "destination directory")
    source_value = require_private_file(
        os.fstat(5), source_device, source_inode, "held source"
    )
    if source_value.st_size != expected_size:
        fail("held source changed expected size")
    if descriptor_digest(5, expected_size, "held source") != expected_digest:
        fail("held source changed expected digest")
    try:
        named_source = lstat_at(3, source_name)
    except OSError as error:
        fail("source entry cannot be inspected: " + error.strerror)
    require_private_file(named_source, source_device, source_inode, "source entry")
    if (
        source_value.st_mode != named_source.st_mode
        or source_value.st_nlink != named_source.st_nlink
        or source_value.st_size != named_source.st_size
    ):
        fail("source entry no longer matches the held source inode")
    require_absent(4, destination_name, "archive destination")
    source_after_digest = require_private_file(
        os.fstat(5), source_device, source_inode, "held source"
    )
    if (
        source_after_digest.st_mode != source_value.st_mode
        or source_after_digest.st_nlink != source_value.st_nlink
        or source_after_digest.st_size != expected_size
        or descriptor_digest(5, expected_size, "held source") != expected_digest
    ):
        fail("held source changed after digest admission")
    native_rename_exclusive(source_name, destination_name)
    try:
        lstat_at(3, source_name)
    except FileNotFoundError:
        pass
    except OSError as error:
        fail("source entry cannot be checked after rename: " + error.strerror)
    else:
        fail("source entry reappeared during exclusive rename")
    try:
        destination_value = lstat_at(4, destination_name)
    except OSError as error:
        fail("archive destination cannot be inspected after rename: " + error.strerror)
    require_private_file(
        destination_value, source_device, source_inode, "archive destination"
    )
    descriptor = os.open(
        destination_name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
        dir_fd=4,
    )
    try:
        opened_destination = require_private_file(
            os.fstat(descriptor), source_device, source_inode, "opened archive destination"
        )
        if opened_destination.st_size != expected_size:
            fail("archive destination changed expected size")
        if descriptor_digest(descriptor, expected_size, "archive destination") != expected_digest:
            fail("archive destination changed expected digest")
    finally:
        os.close(descriptor)


def sync_directory(arguments):
    if len(arguments) != 2:
        fail("sync requires one directory generation")
    expected_device = integer(arguments[0], "directory device")
    expected_inode = integer(arguments[1], "directory inode")
    require_directory(3, expected_device, expected_inode, "sync directory")
    try:
        os.fsync(3)
    except OSError as error:
        fail("directory fsync is unavailable: " + error.strerror)


def read_generation(arguments):
    if len(arguments) != 5:
        fail("read requires one entry and two generations")
    name = entry_name(arguments[0], "read entry")
    directory_device = integer(arguments[1], "directory device")
    directory_inode = integer(arguments[2], "directory inode")
    file_device = integer(arguments[3], "file device")
    file_inode = integer(arguments[4], "file inode")
    require_directory(3, directory_device, directory_inode, "read directory")
    try:
        named_before = lstat_at(3, name)
    except OSError as error:
        fail("read entry cannot be inspected before open: " + error.strerror)
    require_private_file(named_before, file_device, file_inode, "named read entry")
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
        dir_fd=3,
    )
    try:
        expected = require_private_file(
            os.fstat(descriptor), file_device, file_inode, "read entry"
        )
        data = bytearray()
        while True:
            chunk = os.read(descriptor, min(64 * 1024, MAX_PRIVATE_FILE_BYTES + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
            if len(data) > MAX_PRIVATE_FILE_BYTES:
                fail("read entry exceeds the private file size boundary")
        if len(data) != expected.st_size:
            fail("read entry size changed while held")
        try:
            named_after = lstat_at(3, name)
        except OSError as error:
            fail("read entry cannot be inspected after read: " + error.strerror)
        require_private_file(named_after, file_device, file_inode, "named read entry")
        if (
            named_before.st_mode != named_after.st_mode
            or named_before.st_nlink != named_after.st_nlink
            or named_before.st_size != named_after.st_size
        ):
            fail("named read entry changed metadata during read")
        sys.stdout.buffer.write(data)
    finally:
        os.close(descriptor)


def list_directory(arguments):
    if len(arguments) != 2:
        fail("list requires one directory generation")
    expected_device = integer(arguments[0], "directory device")
    expected_inode = integer(arguments[1], "directory inode")
    require_directory(3, expected_device, expected_inode, "list directory")
    try:
        entries = sorted(os.listdir(3))
    except OSError as error:
        fail("directory listing failed: " + error.strerror)
    for value in entries:
        entry_name(value, "listed entry")
    sys.stdout.buffer.write(b"\x00".join(os.fsencode(value) for value in entries))


def require_missing(arguments):
    if len(arguments) != 3:
        fail("missing requires one entry and one directory generation")
    name = entry_name(arguments[0], "missing entry")
    expected_device = integer(arguments[1], "directory device")
    expected_inode = integer(arguments[2], "directory inode")
    require_directory(3, expected_device, expected_inode, "missing directory")
    require_absent(3, name, "source entry")


def ensure_directory(arguments):
    if len(arguments) != 3:
        fail("mkdir requires one entry and one parent directory generation")
    name = entry_name(arguments[0], "directory entry")
    parent_device = integer(arguments[1], "parent directory device")
    parent_inode = integer(arguments[2], "parent directory inode")
    require_directory(3, parent_device, parent_inode, "parent directory")
    created = False
    try:
        os.mkdir(name, 0o700, dir_fd=3)
        created = True
    except FileExistsError:
        pass
    except OSError as error:
        fail("directory entry cannot be created: " + error.strerror)
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    descriptor = None
    try:
        descriptor = os.open(name, flags, dir_fd=3)
        value = require_directory(
            descriptor,
            parent_device,
            os.fstat(descriptor).st_ino,
            "directory entry",
        )
        named = lstat_at(3, name)
        if (
            not stat.S_ISDIR(named.st_mode)
            or stat.S_ISLNK(named.st_mode)
            or named.st_dev != value.st_dev
            or named.st_ino != value.st_ino
            or named.st_uid != value.st_uid
            or stat.S_IMODE(named.st_mode) != 0o700
        ):
            fail("directory entry changed generation during admission")
        sys.stdout.write(
            json.dumps(
                {
                    "protocol": PROTOCOL,
                    "created": created,
                    "device": str(value.st_dev),
                    "inode": str(value.st_ino),
                },
                sort_keys=True,
                separators=(",", ":"),
            )
        )
    finally:
        if descriptor is not None:
            os.close(descriptor)


class DarwinStatFs(ctypes.Structure):
    _fields_ = [
        ("f_bsize", ctypes.c_uint32),
        ("f_iosize", ctypes.c_int32),
        ("f_blocks", ctypes.c_uint64),
        ("f_bfree", ctypes.c_uint64),
        ("f_bavail", ctypes.c_uint64),
        ("f_files", ctypes.c_uint64),
        ("f_ffree", ctypes.c_uint64),
        ("f_fsid", ctypes.c_int32 * 2),
        ("f_owner", ctypes.c_uint32),
        ("f_type", ctypes.c_uint32),
        ("f_flags", ctypes.c_uint32),
        ("f_fssubtype", ctypes.c_uint32),
        ("f_fstypename", ctypes.c_char * 16),
        ("f_mntonname", ctypes.c_char * 1024),
        ("f_mntfromname", ctypes.c_char * 1024),
        ("f_reserved", ctypes.c_uint32 * 8),
    ]


class LinuxStatFs(ctypes.Structure):
    _fields_ = [
        ("f_type", ctypes.c_long),
        ("f_bsize", ctypes.c_long),
        ("f_blocks", ctypes.c_ulong),
        ("f_bfree", ctypes.c_ulong),
        ("f_bavail", ctypes.c_ulong),
        ("f_files", ctypes.c_ulong),
        ("f_ffree", ctypes.c_ulong),
        ("f_fsid", ctypes.c_int * 2),
        ("f_namelen", ctypes.c_long),
        ("f_frsize", ctypes.c_long),
        ("f_flags", ctypes.c_long),
        ("f_spare", ctypes.c_long * 4),
    ]


LINUX_LOCAL_FILESYSTEMS = {
    0x00001190: "tmpfs",
    0x0000137D: "ext",
    0x0000EF53: "ext2-ext4",
    0x01021994: "tmpfs",
    0x2FC12FC1: "zfs",
    0x4244: "hfs",
    0x52654973: "reiserfs",
    0x58465342: "xfs",
    0x9123683E: "btrfs",
    0x794C7630: "overlayfs",
}


def filesystem_capacity(arguments):
    if len(arguments) != 2:
        fail("filesystem requires one directory generation")
    expected_device = integer(arguments[0], "directory device")
    expected_inode = integer(arguments[1], "directory inode")
    value = require_directory(3, expected_device, expected_inode, "filesystem directory")
    libc = ctypes.CDLL(None, use_errno=True)
    system = platform.system()
    if system == "Darwin":
        filesystem = DarwinStatFs()
        operation = getattr(libc, "fstatfs", None)
        if operation is None:
            fail("fstatfs is unavailable")
        operation.argtypes = [ctypes.c_int, ctypes.POINTER(DarwinStatFs)]
        operation.restype = ctypes.c_int
        if operation(3, ctypes.byref(filesystem)) != 0:
            fail("fstatfs failed: " + os.strerror(ctypes.get_errno()))
        filesystem_type = bytes(filesystem.f_fstypename).split(b"\x00", 1)[0].decode("ascii")
        local = (filesystem.f_flags & MNT_LOCAL) != 0
    elif system == "Linux":
        filesystem = LinuxStatFs()
        operation = getattr(libc, "fstatfs", None)
        if operation is None:
            fail("fstatfs is unavailable")
        operation.argtypes = [ctypes.c_int, ctypes.POINTER(LinuxStatFs)]
        operation.restype = ctypes.c_int
        if operation(3, ctypes.byref(filesystem)) != 0:
            fail("fstatfs failed: " + os.strerror(ctypes.get_errno()))
        filesystem_magic = filesystem.f_type & 0xFFFFFFFF
        filesystem_type = LINUX_LOCAL_FILESYSTEMS.get(filesystem_magic, "0x%08x" % filesystem_magic)
        local = filesystem_magic in LINUX_LOCAL_FILESYSTEMS
    else:
        fail("filesystem admission is unsupported on " + system)
    capacity = os.fstatvfs(3)
    result = {
        "protocol": PROTOCOL,
        "platform": system.lower(),
        "device": str(value.st_dev),
        "filesystemType": filesystem_type,
        "local": local,
        "availableBytes": str(capacity.f_bavail * capacity.f_frsize),
        "totalBytes": str(capacity.f_blocks * capacity.f_frsize),
    }
    sys.stdout.write(json.dumps(result, sort_keys=True, separators=(",", ":")))


def probe(arguments):
    if arguments:
        fail("probe takes no arguments")
    system = platform.system()
    if system not in ("Darwin", "Linux"):
        fail("exclusive native rename is unsupported on " + system)
    libc = ctypes.CDLL(None, use_errno=True)
    if system == "Darwin" and getattr(libc, "renameatx_np", None) is None:
        fail("renameatx_np is unavailable")
    if system == "Linux" and getattr(libc, "renameat2", None) is None:
        machine = platform.machine().lower()
        if machine not in ("x86_64", "amd64", "aarch64", "arm64") or getattr(libc, "syscall", None) is None:
            fail("renameat2 is unavailable")
    sys.stdout.write(PROTOCOL + ":" + system.lower())


def main():
    if len(sys.argv) < 2:
        fail("one operation is required")
    operations = {
        "filesystem": filesystem_capacity,
        "list": list_directory,
        "mkdir": ensure_directory,
        "missing": require_missing,
        "probe": probe,
        "read": read_generation,
        "rename": rename_generation,
        "sync": sync_directory,
    }
    operation = operations.get(sys.argv[1])
    if operation is None:
        fail("unsupported operation")
    operation(sys.argv[2:])


if __name__ == "__main__":
    main()
