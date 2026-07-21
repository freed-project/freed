#!/usr/bin/python3

import base64
import codecs
import ctypes
import errno
import fcntl
import hashlib
import json
import os
import platform
import stat
import sys


PROTOCOL = "freed-lease-archive-move-v1"
AUTHORITY_PROTOCOL = "freed-authority-file-operation-v1"
MAX_PRIVATE_FILE_BYTES = 1024 * 1024
MAX_REPAIR_MOVE_BYTES = 128 * 1024 * 1024
MAX_BOUNDED_LIST_ENTRIES = 100_000
MAX_BOUNDED_LIST_ENCODED_BYTES = 16 * 1024 * 1024
MAX_AUTHORITY_INVENTORY_ENTRIES = 100_000
MAX_AUTHORITY_INVENTORY_ENCODED_BYTES = 128 * 1024 * 1024
MAX_AUTHORITY_INVENTORY_TOTAL_BYTES = 4 * 1024 * 1024 * 1024
MAX_CUTOVER_SNAPSHOT_ENTRIES = 4_096
MAX_CUTOVER_SNAPSHOT_DEPTH = 64
MAX_CUTOVER_SNAPSHOT_OUTPUT_BYTES = 32 * 1024 * 1024
MAX_PRIVATE_BATCH_INVENTORY_ENTRIES = 100_000
MAX_PRIVATE_BATCH_SELECTED_ENTRIES = 4_096
MAX_PRIVATE_BATCH_INVENTORY_NAME_BYTES = 32 * 1024 * 1024
MAX_PRIVATE_BATCH_REQUEST_BYTES = 1024 * 1024
MAX_PRIVATE_BATCH_OUTPUT_BYTES = 128 * 1024 * 1024
MAX_PRIVATE_BATCH_INVENTORY_TOTAL_BYTES = 4 * 1024 * 1024 * 1024
MAX_PRIVATE_BATCH_SELECTED_TOTAL_BYTES = 32 * 1024 * 1024
RENAME_EXCL = 0x00000004
RENAME_NOREPLACE = 0x00000001
RENAME_SWAP = 0x00000002
RENAME_EXCHANGE = 0x00000002
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


def directory_snapshot(value):
    return (
        value.st_dev,
        value.st_ino,
        value.st_mode,
        value.st_uid,
        value.st_gid,
        value.st_nlink,
        value.st_size,
        value.st_mtime_ns,
        value.st_ctime_ns,
    )


def require_directory_snapshot(value, expected, label):
    if directory_snapshot(value) != expected:
        fail(label + " changed during admission")


def require_private_directory_generation(
    value,
    expected_device,
    expected_inode,
    expected_mode,
    expected_uid,
    label,
):
    if not stat.S_ISDIR(value.st_mode):
        fail(label + " is not a directory")
    if value.st_dev != expected_device or value.st_ino != expected_inode:
        fail(label + " changed inode generation")
    if expected_mode not in (0o700, 0o755) or stat.S_IMODE(value.st_mode) != expected_mode:
        fail(label + " is not an exact private directory")
    if expected_uid != os.getuid() or value.st_uid != expected_uid:
        fail(label + " is not owned by the current user")
    return value


def require_named_private_directory_generation(
    parent_descriptor,
    name,
    expected_device,
    expected_inode,
    expected_mode,
    expected_uid,
    label,
):
    try:
        named_before = lstat_at(parent_descriptor, name)
    except OSError as error:
        fail(label + " cannot be inspected before open: " + error.strerror)
    require_private_directory_generation(
        named_before,
        expected_device,
        expected_inode,
        expected_mode,
        expected_uid,
        label,
    )
    descriptor = None
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
            dir_fd=parent_descriptor,
        )
        opened = require_private_directory_generation(
            os.fstat(descriptor),
            expected_device,
            expected_inode,
            expected_mode,
            expected_uid,
            "opened " + label,
        )
        try:
            named_after = lstat_at(parent_descriptor, name)
        except OSError as error:
            fail(label + " cannot be inspected after open: " + error.strerror)
        require_private_directory_generation(
            named_after,
            expected_device,
            expected_inode,
            expected_mode,
            expected_uid,
            label,
        )
        require_directory_snapshot(
            opened, directory_snapshot(named_before), label
        )
        require_directory_snapshot(
            named_after, directory_snapshot(named_before), label
        )
        return named_after
    finally:
        if descriptor is not None:
            os.close(descriptor)


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


def require_repair_move_file(
    value,
    expected_device,
    expected_inode,
    expected_mode,
    expected_nlink,
    expected_size,
    label,
):
    if not stat.S_ISREG(value.st_mode):
        fail(label + " is not a regular file")
    if value.st_dev != expected_device or value.st_ino != expected_inode:
        fail(label + " changed inode generation")
    if value.st_uid != os.getuid():
        fail(label + " is not owned by the current user")
    if expected_mode not in (0o600, 0o640, 0o644):
        fail(label + " expected mode is outside the repair allowlist")
    if stat.S_IMODE(value.st_mode) != expected_mode:
        fail(label + " changed exact mode")
    if expected_nlink not in (1, 2) or value.st_nlink != expected_nlink:
        fail(label + " changed exact link count")
    if expected_size < 0 or expected_size > MAX_REPAIR_MOVE_BYTES:
        fail(label + " expected size exceeds the repair move boundary")
    if value.st_size != expected_size:
        fail(label + " changed expected size")
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


def native_rename_exclusive_at(
    source_directory_descriptor,
    source_name,
    destination_directory_descriptor,
    destination_name,
):
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
        result = operation(
            source_directory_descriptor,
            source,
            destination_directory_descriptor,
            destination,
            RENAME_EXCL,
        )
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
            result = operation(
                source_directory_descriptor,
                source,
                destination_directory_descriptor,
                destination,
                RENAME_NOREPLACE,
            )
        else:
            syscall_numbers = {
                "x86_64": 316,
                "amd64": 316,
                "aarch64": 276,
                "arm64": 276,
            }
            syscall_number = syscall_numbers.get(platform.machine().lower())
            syscall = getattr(libc, "syscall", None)
            if syscall_number is None or syscall is None:
                fail("renameat2 is unavailable on this Linux architecture")
            syscall.restype = ctypes.c_long
            result = syscall(
                ctypes.c_long(syscall_number),
                ctypes.c_int(source_directory_descriptor),
                ctypes.c_char_p(source),
                ctypes.c_int(destination_directory_descriptor),
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


def native_rename_exchange(source_name, destination_name):
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
        result = operation(3, source, 4, destination, RENAME_SWAP)
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
            result = operation(3, source, 4, destination, RENAME_EXCHANGE)
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
                ctypes.c_uint(RENAME_EXCHANGE),
            )
    else:
        fail("atomic native exchange is unsupported on " + system)
    if result != 0:
        failure = ctypes.get_errno()
        if failure in (errno.ENOSYS, errno.ENOTSUP, errno.EOPNOTSUPP):
            fail("atomic native exchange is unavailable on this filesystem")
        fail("atomic native exchange failed: " + os.strerror(failure))


def native_rename_replace(source_name, destination_name):
    libc = ctypes.CDLL(None, use_errno=True)
    operation = getattr(libc, "renameat", None)
    if operation is None:
        fail("descriptor-relative atomic replacement is unavailable")
    operation.argtypes = [
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
    ]
    operation.restype = ctypes.c_int
    result = operation(
        3,
        ctypes.c_char_p(os.fsencode(source_name)),
        4,
        ctypes.c_char_p(os.fsencode(destination_name)),
    )
    if result != 0:
        failure = ctypes.get_errno()
        if failure in (errno.ENOSYS, errno.ENOTSUP, errno.EOPNOTSUPP):
            fail("descriptor-relative atomic replacement is unavailable on this filesystem")
        fail("descriptor-relative atomic replacement failed: " + os.strerror(failure))


def repair_move_test_pause(checkpoint, operation_name, source_name, destination_name):
    selected = os.environ.get("FREED_REPAIR_MOVE_TEST_PAUSE")
    if not selected or selected != checkpoint:
        return
    selected_operation = os.environ.get("FREED_REPAIR_MOVE_TEST_OPERATION")
    selected_source = os.environ.get("FREED_REPAIR_MOVE_TEST_SOURCE")
    selected_destination = os.environ.get("FREED_REPAIR_MOVE_TEST_DESTINATION")
    if selected_operation and selected_operation != operation_name:
        return
    if selected_source and selected_source != source_name:
        return
    if selected_destination and selected_destination != destination_name:
        return
    release_descriptor = 6
    signal_descriptor = 7
    configured_descriptors = os.environ.get("FREED_REPAIR_MOVE_TEST_CONTROL_FDS")
    if configured_descriptors:
        pieces = configured_descriptors.split(",")
        if len(pieces) != 2:
            fail("repair move test control descriptors are invalid")
        release_descriptor = integer(pieces[0], "repair move test release descriptor")
        signal_descriptor = integer(pieces[1], "repair move test signal descriptor")
    try:
        os.write(signal_descriptor, (checkpoint + "\n").encode("ascii"))
        if os.read(release_descriptor, 1) != b"1":
            fail("repair move test pause was not released")
    except OSError as error:
        fail("repair move test pause failed: " + error.strerror)


def fsync_repair_directory(descriptor, label):
    try:
        os.fsync(descriptor)
    except OSError as error:
        fail(label + " fsync failed: " + error.strerror)


def require_repair_file_digest(
    descriptor,
    expected_device,
    expected_inode,
    expected_mode,
    expected_nlink,
    expected_size,
    expected_digest,
    label,
):
    value = require_repair_move_file(
        os.fstat(descriptor),
        expected_device,
        expected_inode,
        expected_mode,
        expected_nlink,
        expected_size,
        label,
    )
    if descriptor_digest(descriptor, expected_size, label) != expected_digest:
        fail(label + " changed expected digest")
    return value


def require_named_repair_file_digest(
    directory_descriptor,
    name,
    expected_device,
    expected_inode,
    expected_mode,
    expected_nlink,
    expected_size,
    expected_digest,
    label,
):
    try:
        named_before = lstat_at(directory_descriptor, name)
    except OSError as error:
        fail(label + " cannot be inspected before open: " + error.strerror)
    require_repair_move_file(
        named_before,
        expected_device,
        expected_inode,
        expected_mode,
        expected_nlink,
        expected_size,
        label,
    )
    descriptor = None
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
            dir_fd=directory_descriptor,
        )
        require_repair_file_digest(
            descriptor,
            expected_device,
            expected_inode,
            expected_mode,
            expected_nlink,
            expected_size,
            expected_digest,
            "opened " + label,
        )
        try:
            named_after = lstat_at(directory_descriptor, name)
        except OSError as error:
            fail(label + " cannot be inspected after read: " + error.strerror)
        require_repair_move_file(
            named_after,
            expected_device,
            expected_inode,
            expected_mode,
            expected_nlink,
            expected_size,
            label,
        )
        if (
            named_before.st_mode != named_after.st_mode
            or named_before.st_nlink != named_after.st_nlink
            or named_before.st_size != named_after.st_size
        ):
            fail(label + " changed metadata during digest admission")
        return named_after
    finally:
        if descriptor is not None:
            os.close(descriptor)


def repair_file_snapshot(value):
    return (
        value.st_dev,
        value.st_ino,
        value.st_mode,
        value.st_uid,
        value.st_gid,
        value.st_nlink,
        value.st_size,
        value.st_mtime_ns,
        value.st_ctime_ns,
    )


def require_repair_file_snapshot(value, expected, label):
    if repair_file_snapshot(value) != expected:
        fail(label + " changed during admission")


def require_detached_repair_file_digest(
    descriptor,
    expected_device,
    expected_inode,
    expected_mode,
    expected_link_count,
    expected_size,
    expected_digest,
    label,
):
    try:
        value = os.fstat(descriptor)
    except OSError as error:
        fail(label + " descriptor cannot be inspected: " + error.strerror)
    if not stat.S_ISREG(value.st_mode):
        fail(label + " is not a regular file")
    if value.st_dev != expected_device or value.st_ino != expected_inode:
        fail(label + " changed inode generation")
    if value.st_uid != os.getuid():
        fail(label + " is not owned by the current user")
    if expected_mode not in (0o600, 0o640, 0o644):
        fail(label + " expected mode is outside the repair allowlist")
    if stat.S_IMODE(value.st_mode) != expected_mode:
        fail(label + " changed exact mode")
    if expected_link_count not in (0, 1) or value.st_nlink != expected_link_count:
        fail(label + " did not lose exactly one admitted link")
    if expected_size < 0 or expected_size > MAX_REPAIR_MOVE_BYTES:
        fail(label + " expected size exceeds the repair move boundary")
    if value.st_size != expected_size:
        fail(label + " changed expected size")
    if descriptor_digest(descriptor, expected_size, label) != expected_digest:
        fail(label + " changed expected digest")
    return value


def require_rename_topology_before(
    source_name,
    destination_name,
    source_device,
    source_inode,
    expected_mode,
    expected_nlink,
    expected_size,
    expected_digest,
    source_directory_device,
    source_directory_inode,
    destination_directory_device,
    destination_directory_inode,
):
    require_directory(
        3,
        source_directory_device,
        source_directory_inode,
        "repair source directory",
    )
    require_directory(
        4,
        destination_directory_device,
        destination_directory_inode,
        "repair destination directory",
    )
    require_repair_file_digest(
        5,
        source_device,
        source_inode,
        expected_mode,
        expected_nlink,
        expected_size,
        expected_digest,
        "held repair source",
    )
    require_named_repair_file_digest(
        3,
        source_name,
        source_device,
        source_inode,
        expected_mode,
        expected_nlink,
        expected_size,
        expected_digest,
        "repair source entry",
    )
    require_absent(4, destination_name, "repair move destination")


def require_rename_topology_after(
    source_name,
    destination_name,
    source_device,
    source_inode,
    expected_mode,
    expected_nlink,
    expected_size,
    expected_digest,
    source_directory_device,
    source_directory_inode,
    destination_directory_device,
    destination_directory_inode,
):
    require_directory(
        3,
        source_directory_device,
        source_directory_inode,
        "repair source directory",
    )
    require_directory(
        4,
        destination_directory_device,
        destination_directory_inode,
        "repair destination directory",
    )
    require_repair_file_digest(
        5,
        source_device,
        source_inode,
        expected_mode,
        expected_nlink,
        expected_size,
        expected_digest,
        "held repair source",
    )
    try:
        lstat_at(3, source_name)
    except FileNotFoundError:
        pass
    except OSError as error:
        fail("repair source entry cannot be checked after rename: " + error.strerror)
    else:
        fail("repair source entry reappeared during exclusive rename")
    require_named_repair_file_digest(
        4,
        destination_name,
        source_device,
        source_inode,
        expected_mode,
        expected_nlink,
        expected_size,
        expected_digest,
        "repair move destination",
    )


def require_exchange_topology_before(
    source_name,
    destination_name,
    source_identity,
    destination_identity,
    source_directory_identity,
    destination_directory_identity,
    destination_descriptor,
):
    (
        source_device,
        source_inode,
        source_mode,
        source_nlink,
        source_size,
        source_digest,
    ) = source_identity
    (
        destination_device,
        destination_inode,
        destination_mode,
        destination_nlink,
        destination_size,
        destination_digest,
    ) = destination_identity
    if source_device == destination_device and source_inode == destination_inode:
        fail("exchange source and destination must be two distinct inodes")
    if (
        source_directory_identity == destination_directory_identity
        and source_name == destination_name
    ):
        fail("exchange source and destination must be distinct entries")
    require_directory(
        3,
        source_directory_identity[0],
        source_directory_identity[1],
        "exchange source directory",
    )
    require_directory(
        4,
        destination_directory_identity[0],
        destination_directory_identity[1],
        "exchange destination directory",
    )
    require_repair_file_digest(
        5,
        source_device,
        source_inode,
        source_mode,
        source_nlink,
        source_size,
        source_digest,
        "held exchange source",
    )
    require_repair_file_digest(
        destination_descriptor,
        destination_device,
        destination_inode,
        destination_mode,
        destination_nlink,
        destination_size,
        destination_digest,
        "held exchange destination",
    )
    require_named_repair_file_digest(
        3,
        source_name,
        source_device,
        source_inode,
        source_mode,
        source_nlink,
        source_size,
        source_digest,
        "exchange source entry",
    )
    require_named_repair_file_digest(
        4,
        destination_name,
        destination_device,
        destination_inode,
        destination_mode,
        destination_nlink,
        destination_size,
        destination_digest,
        "exchange destination entry",
    )


def require_exchange_topology_after(
    source_name,
    destination_name,
    source_identity,
    destination_identity,
    source_directory_identity,
    destination_directory_identity,
    destination_descriptor,
):
    (
        source_device,
        source_inode,
        source_mode,
        source_nlink,
        source_size,
        source_digest,
    ) = source_identity
    (
        destination_device,
        destination_inode,
        destination_mode,
        destination_nlink,
        destination_size,
        destination_digest,
    ) = destination_identity
    require_directory(
        3,
        source_directory_identity[0],
        source_directory_identity[1],
        "exchange source directory",
    )
    require_directory(
        4,
        destination_directory_identity[0],
        destination_directory_identity[1],
        "exchange destination directory",
    )
    require_repair_file_digest(
        5,
        source_device,
        source_inode,
        source_mode,
        source_nlink,
        source_size,
        source_digest,
        "held exchange source after exchange",
    )
    require_repair_file_digest(
        destination_descriptor,
        destination_device,
        destination_inode,
        destination_mode,
        destination_nlink,
        destination_size,
        destination_digest,
        "held exchange destination after exchange",
    )
    require_named_repair_file_digest(
        3,
        source_name,
        destination_device,
        destination_inode,
        destination_mode,
        destination_nlink,
        destination_size,
        destination_digest,
        "exchanged predecessor entry",
    )
    require_named_repair_file_digest(
        4,
        destination_name,
        source_device,
        source_inode,
        source_mode,
        source_nlink,
        source_size,
        source_digest,
        "exchanged successor entry",
    )


def require_replace_topology_before(
    source_name,
    destination_name,
    source_identity,
    destination_identity,
    source_directory_identity,
    destination_directory_identity,
    expected_snapshots=None,
):
    (
        source_device,
        source_inode,
        source_mode,
        source_nlink,
        source_size,
        source_digest,
    ) = source_identity
    (
        destination_device,
        destination_inode,
        destination_mode,
        destination_nlink,
        destination_size,
        destination_digest,
    ) = destination_identity
    if source_device == destination_device and source_inode == destination_inode:
        fail("replacement source and destination must be two distinct inodes")
    if (
        source_directory_identity == destination_directory_identity
        and source_name == destination_name
    ):
        fail("replacement source and destination must be distinct entries")
    if (
        source_device != source_directory_identity[0]
        or destination_device != destination_directory_identity[0]
        or source_directory_identity[0] != destination_directory_identity[0]
    ):
        fail("replacement files and parents must share one device")
    source_directory = require_directory(
        3,
        source_directory_identity[0],
        source_directory_identity[1],
        "replacement source directory",
    )
    destination_directory = require_directory(
        4,
        destination_directory_identity[0],
        destination_directory_identity[1],
        "replacement destination directory",
    )
    held_source = require_repair_file_digest(
        5,
        source_device,
        source_inode,
        source_mode,
        source_nlink,
        source_size,
        source_digest,
        "held replacement source",
    )
    held_destination = require_repair_file_digest(
        6,
        destination_device,
        destination_inode,
        destination_mode,
        destination_nlink,
        destination_size,
        destination_digest,
        "held replacement predecessor",
    )
    named_source = require_named_repair_file_digest(
        3,
        source_name,
        source_device,
        source_inode,
        source_mode,
        source_nlink,
        source_size,
        source_digest,
        "replacement source entry",
    )
    named_destination = require_named_repair_file_digest(
        4,
        destination_name,
        destination_device,
        destination_inode,
        destination_mode,
        destination_nlink,
        destination_size,
        destination_digest,
        "replacement predecessor entry",
    )
    require_repair_file_snapshot(
        named_source,
        repair_file_snapshot(held_source),
        "replacement source entry",
    )
    require_repair_file_snapshot(
        named_destination,
        repair_file_snapshot(held_destination),
        "replacement predecessor entry",
    )
    snapshots = (
        directory_snapshot(source_directory),
        directory_snapshot(destination_directory),
        repair_file_snapshot(held_source),
        repair_file_snapshot(held_destination),
    )
    require_directory_snapshot(
        os.fstat(3), snapshots[0], "replacement source directory"
    )
    require_directory_snapshot(
        os.fstat(4), snapshots[1], "replacement destination directory"
    )
    if expected_snapshots is not None:
        require_directory_snapshot(
            source_directory,
            expected_snapshots[0],
            "replacement source directory",
        )
        require_directory_snapshot(
            destination_directory,
            expected_snapshots[1],
            "replacement destination directory",
        )
        require_repair_file_snapshot(
            held_source,
            expected_snapshots[2],
            "held replacement source",
        )
        require_repair_file_snapshot(
            held_destination,
            expected_snapshots[3],
            "held replacement predecessor",
        )
    return snapshots


def require_replace_topology_after(
    source_name,
    destination_name,
    source_identity,
    destination_identity,
    source_directory_identity,
    destination_directory_identity,
):
    (
        source_device,
        source_inode,
        source_mode,
        source_nlink,
        source_size,
        source_digest,
    ) = source_identity
    (
        destination_device,
        destination_inode,
        destination_mode,
        destination_nlink,
        destination_size,
        destination_digest,
    ) = destination_identity
    require_directory(
        3,
        source_directory_identity[0],
        source_directory_identity[1],
        "replacement source directory",
    )
    require_directory(
        4,
        destination_directory_identity[0],
        destination_directory_identity[1],
        "replacement destination directory",
    )
    require_repair_file_digest(
        5,
        source_device,
        source_inode,
        source_mode,
        source_nlink,
        source_size,
        source_digest,
        "held replacement successor",
    )
    require_detached_repair_file_digest(
        6,
        destination_device,
        destination_inode,
        destination_mode,
        destination_nlink - 1,
        destination_size,
        destination_digest,
        "held replacement predecessor",
    )
    try:
        lstat_at(3, source_name)
    except FileNotFoundError:
        pass
    except OSError as error:
        fail("replacement source entry cannot be checked: " + error.strerror)
    else:
        fail("replacement source entry reappeared after atomic replacement")
    require_named_repair_file_digest(
        4,
        destination_name,
        source_device,
        source_inode,
        source_mode,
        source_nlink,
        source_size,
        source_digest,
        "replacement destination entry",
    )


def require_remove_topology_before(
    name,
    file_identity,
    parent_identity,
    expected_snapshots=None,
):
    (
        file_device,
        file_inode,
        file_mode,
        file_nlink,
        file_size,
        file_digest,
    ) = file_identity
    if file_device != parent_identity[0]:
        fail("removed file and parent must share one device")
    parent = require_directory(
        3, parent_identity[0], parent_identity[1], "removal parent directory"
    )
    held = require_repair_file_digest(
        4,
        file_device,
        file_inode,
        file_mode,
        file_nlink,
        file_size,
        file_digest,
        "held removal generation",
    )
    named = require_named_repair_file_digest(
        3,
        name,
        file_device,
        file_inode,
        file_mode,
        file_nlink,
        file_size,
        file_digest,
        "removal entry",
    )
    require_repair_file_snapshot(
        named, repair_file_snapshot(held), "removal entry"
    )
    snapshots = (directory_snapshot(parent), repair_file_snapshot(held))
    require_directory_snapshot(
        os.fstat(3), snapshots[0], "removal parent directory"
    )
    if expected_snapshots is not None:
        require_directory_snapshot(
            parent, expected_snapshots[0], "removal parent directory"
        )
        require_repair_file_snapshot(
            held, expected_snapshots[1], "held removal generation"
        )
    return snapshots


def require_remove_topology_after(name, file_identity, parent_identity):
    (
        file_device,
        file_inode,
        file_mode,
        file_nlink,
        file_size,
        file_digest,
    ) = file_identity
    require_directory(
        3, parent_identity[0], parent_identity[1], "removal parent directory"
    )
    require_detached_repair_file_digest(
        4,
        file_device,
        file_inode,
        file_mode,
        file_nlink - 1,
        file_size,
        file_digest,
        "held removed generation",
    )
    try:
        lstat_at(3, name)
    except FileNotFoundError:
        return
    except OSError as error:
        fail("removed entry cannot be checked: " + error.strerror)
    fail("removed entry reappeared after descriptor-relative unlink")


def cutover_snapshot_name(value, label):
    value = entry_name(value, label)
    try:
        encoded = value.encode("utf-8", "strict")
    except UnicodeEncodeError:
        fail(label + " is not valid UTF-8")
    if encoded.decode("utf-8", "strict") != value:
        fail(label + " is not canonical UTF-8")
    return value, encoded


def require_cutover_snapshot_directory(
    value,
    expected_device,
    expected_inode,
    expected_mode,
    label,
):
    if not stat.S_ISDIR(value.st_mode):
        fail(label + " is not a directory")
    if value.st_dev != expected_device or value.st_ino != expected_inode:
        fail(label + " changed inode generation")
    if value.st_uid != os.getuid():
        fail(label + " is not owned by the current user")
    if expected_mode not in (0o700, 0o755):
        fail(label + " expected mode is outside the snapshot allowlist")
    if stat.S_IMODE(value.st_mode) != expected_mode:
        fail(label + " changed exact mode")
    return value


def require_cutover_snapshot_file(value, max_file_bytes, label):
    if not stat.S_ISREG(value.st_mode):
        fail(label + " is not a regular file")
    if value.st_uid != os.getuid():
        fail(label + " is not owned by the current user")
    if stat.S_IMODE(value.st_mode) not in (0o600, 0o640, 0o644):
        fail(label + " mode is outside the snapshot allowlist")
    if value.st_nlink != 1:
        fail(label + " does not have exactly one link")
    if value.st_size < 0 or value.st_size > max_file_bytes:
        fail(label + " exceeds the requested file boundary")
    return value


def cutover_snapshot_digest_value(entry, include_name=True):
    result = {
        "kind": entry["kind"],
        "mode": entry["mode"],
    }
    if include_name:
        result["name"] = entry["name"]
    if entry["kind"] == "file":
        result["size"] = entry["size"]
        result["digest"] = entry["digest"]
    elif entry["kind"] == "directory":
        result["entries"] = [
            cutover_snapshot_digest_value(child, True)
            for child in entry["entries"]
        ]
    return result


def cutover_snapshot_tree_digest(entry):
    encoded = (
        json.dumps(
            cutover_snapshot_digest_value(entry, False),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        + "\n"
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def cutover_snapshot_read_file(
    parent_descriptor,
    name,
    include_bytes,
    max_file_bytes,
    budget,
):
    try:
        named_before = lstat_at(parent_descriptor, name)
    except OSError as error:
        fail("snapshot file cannot be inspected before open: " + error.strerror)
    require_cutover_snapshot_file(
        named_before, max_file_bytes, "snapshot file"
    )
    descriptor = None
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
            dir_fd=parent_descriptor,
        )
        opened_before = require_cutover_snapshot_file(
            os.fstat(descriptor), max_file_bytes, "opened snapshot file"
        )
        if repair_file_snapshot(opened_before) != repair_file_snapshot(named_before):
            fail("snapshot file opened a different generation")
        repair_move_test_pause(
            "after-snapshot-file-open-before-read",
            "snapshot-tree",
            name,
            "",
        )
        budget["aggregate_bytes"] += opened_before.st_size
        if budget["aggregate_bytes"] > budget["max_total_bytes"]:
            fail("snapshot tree exceeds the requested aggregate byte boundary")
        digest = hashlib.sha256()
        retained = []
        offset = 0
        while offset < opened_before.st_size:
            chunk = os.pread(
                descriptor,
                min(64 * 1024, opened_before.st_size - offset),
                offset,
            )
            if not chunk:
                fail("snapshot file changed size while being read")
            digest.update(chunk)
            if include_bytes:
                retained.append(chunk)
            offset += len(chunk)
        if os.pread(descriptor, 1, opened_before.st_size):
            fail("snapshot file grew while being read")
        opened_after = require_cutover_snapshot_file(
            os.fstat(descriptor), max_file_bytes, "opened snapshot file"
        )
        if repair_file_snapshot(opened_after) != repair_file_snapshot(opened_before):
            fail("snapshot file changed while being read")
        try:
            named_after = lstat_at(parent_descriptor, name)
        except OSError as error:
            fail("snapshot file cannot be inspected after read: " + error.strerror)
        require_cutover_snapshot_file(
            named_after, max_file_bytes, "snapshot file"
        )
        if repair_file_snapshot(named_after) != repair_file_snapshot(opened_before):
            fail("snapshot file changed during admission")
        result = {
            "name": name,
            "kind": "file",
            "mode": stat.S_IMODE(opened_before.st_mode),
            "size": opened_before.st_size,
            "digest": digest.hexdigest(),
        }
        if include_bytes:
            result["bytesBase64"] = base64.b64encode(b"".join(retained)).decode(
                "ascii"
            )
        return result
    finally:
        if descriptor is not None:
            os.close(descriptor)


def cutover_snapshot_directory_names(descriptor, budget, label):
    names = []
    try:
        with os.scandir(descriptor) as iterator:
            for candidate in iterator:
                name, encoded_name = cutover_snapshot_name(
                    candidate.name, "snapshot directory entry"
                )
                if budget["entries"] + len(names) >= budget["max_entries"]:
                    fail("snapshot tree exceeds the requested entry boundary")
                names.append((encoded_name, name))
    except OSError as error:
        fail(label + " cannot be listed: " + error.strerror)
    names.sort(key=lambda value: value[0])
    return names


def cutover_snapshot_directory(
    descriptor,
    name,
    expected,
    include_bytes,
    max_file_bytes,
    budget,
    depth,
):
    if depth > budget["max_depth"]:
        fail("snapshot tree exceeds the requested depth boundary")
    admitted = require_cutover_snapshot_directory(
        os.fstat(descriptor),
        expected.st_dev,
        expected.st_ino,
        stat.S_IMODE(expected.st_mode),
        "snapshot directory",
    )
    admitted_snapshot = directory_snapshot(admitted)
    names = cutover_snapshot_directory_names(
        descriptor, budget, "snapshot directory"
    )
    entries = []
    for _encoded_name, child_name in names:
        if depth + 1 > budget["max_depth"]:
            fail("snapshot tree exceeds the requested depth boundary")
        budget["entries"] += 1
        if budget["entries"] > budget["max_entries"]:
            fail("snapshot tree exceeds the requested entry boundary")
        try:
            child_before = lstat_at(descriptor, child_name)
        except OSError as error:
            fail("snapshot entry cannot be inspected: " + error.strerror)
        if stat.S_ISLNK(child_before.st_mode):
            fail("snapshot entry is a symbolic link")
        if stat.S_ISDIR(child_before.st_mode):
            child_descriptor = None
            try:
                child_descriptor = os.open(
                    child_name,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=descriptor,
                )
                child_opened = require_cutover_snapshot_directory(
                    os.fstat(child_descriptor),
                    child_before.st_dev,
                    child_before.st_ino,
                    stat.S_IMODE(child_before.st_mode),
                    "opened snapshot directory",
                )
                require_directory_snapshot(
                    child_opened,
                    directory_snapshot(child_before),
                    "snapshot directory entry",
                )
                child = cutover_snapshot_directory(
                    child_descriptor,
                    child_name,
                    child_opened,
                    include_bytes,
                    max_file_bytes,
                    budget,
                    depth + 1,
                )
                try:
                    child_after = lstat_at(descriptor, child_name)
                except OSError as error:
                    fail(
                        "snapshot directory entry cannot be re-inspected: "
                        + error.strerror
                    )
                require_cutover_snapshot_directory(
                    child_after,
                    child_opened.st_dev,
                    child_opened.st_ino,
                    stat.S_IMODE(child_opened.st_mode),
                    "snapshot directory entry",
                )
                require_directory_snapshot(
                    child_after,
                    directory_snapshot(child_opened),
                    "snapshot directory entry",
                )
                entries.append(child)
            finally:
                if child_descriptor is not None:
                    os.close(child_descriptor)
            continue
        if stat.S_ISREG(child_before.st_mode):
            entries.append(
                cutover_snapshot_read_file(
                    descriptor,
                    child_name,
                    include_bytes,
                    max_file_bytes,
                    budget,
                )
            )
            continue
        fail("snapshot entry is not a regular file or directory")
    final_names = cutover_snapshot_directory_names(
        descriptor, budget, "snapshot directory"
    )
    if names != final_names:
        fail("snapshot directory entries changed during admission")
    require_directory_snapshot(
        require_cutover_snapshot_directory(
            os.fstat(descriptor),
            admitted.st_dev,
            admitted.st_ino,
            stat.S_IMODE(admitted.st_mode),
            "snapshot directory",
        ),
        admitted_snapshot,
        "snapshot directory",
    )
    return {
        "name": name,
        "kind": "directory",
        "mode": stat.S_IMODE(admitted.st_mode),
        "entries": entries,
    }


def cutover_snapshot_named_entry(
    parent_descriptor,
    name,
    include_bytes,
    max_file_bytes,
    budget,
):
    parent = os.fstat(parent_descriptor)
    parent_snapshot = directory_snapshot(parent)
    try:
        named = lstat_at(parent_descriptor, name)
    except FileNotFoundError:
        missing = True
    except OSError as error:
        fail("snapshot target cannot be inspected: " + error.strerror)
    else:
        missing = False
    budget["entries"] += 1
    if budget["entries"] > budget["max_entries"]:
        fail("snapshot tree exceeds the requested entry boundary")
    if missing:
        try:
            lstat_at(parent_descriptor, name)
        except FileNotFoundError:
            pass
        except OSError as error:
            fail("snapshot target cannot be re-inspected: " + error.strerror)
        else:
            fail("snapshot target appeared during missing proof")
        require_directory_snapshot(
            os.fstat(parent_descriptor), parent_snapshot, "snapshot parent"
        )
        return {"name": name, "kind": "missing"}
    if stat.S_ISLNK(named.st_mode):
        fail("snapshot target is a symbolic link")
    if stat.S_ISREG(named.st_mode):
        result = cutover_snapshot_read_file(
            parent_descriptor,
            name,
            include_bytes,
            max_file_bytes,
            budget,
        )
    elif stat.S_ISDIR(named.st_mode):
        descriptor = None
        try:
            descriptor = os.open(
                name,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                dir_fd=parent_descriptor,
            )
            opened = require_cutover_snapshot_directory(
                os.fstat(descriptor),
                named.st_dev,
                named.st_ino,
                stat.S_IMODE(named.st_mode),
                "opened snapshot target",
            )
            require_directory_snapshot(
                opened, directory_snapshot(named), "snapshot target"
            )
            repair_move_test_pause(
                "after-snapshot-tree-root-open-before-traversal",
                "snapshot-tree",
                name,
                "",
            )
            result = cutover_snapshot_directory(
                descriptor,
                name,
                opened,
                include_bytes,
                max_file_bytes,
                budget,
                0,
            )
            try:
                named_after = lstat_at(parent_descriptor, name)
            except OSError as error:
                fail("snapshot target cannot be re-inspected: " + error.strerror)
            require_cutover_snapshot_directory(
                named_after,
                opened.st_dev,
                opened.st_ino,
                stat.S_IMODE(opened.st_mode),
                "snapshot target",
            )
            require_directory_snapshot(
                named_after, directory_snapshot(opened), "snapshot target"
            )
        finally:
            if descriptor is not None:
                os.close(descriptor)
    else:
        fail("snapshot target is not a regular file or directory")
    require_directory_snapshot(
        os.fstat(parent_descriptor), parent_snapshot, "snapshot parent"
    )
    return result


def parse_cutover_snapshot_request(arguments, label):
    if len(arguments) != 10:
        fail(
            label
            + " requires one name, one byte policy, five bounds, and one parent generation"
        )
    name, _encoded_name = cutover_snapshot_name(arguments[0], label + " name")
    if arguments[1] not in ("0", "1"):
        fail(label + " include-bytes policy must be 0 or 1")
    include_bytes = arguments[1] == "1"
    max_file_bytes = integer(arguments[2], label + " file byte limit")
    max_entries = integer(arguments[3], label + " entry limit")
    max_depth = integer(arguments[4], label + " depth limit")
    max_total_bytes = integer(arguments[5], label + " aggregate byte limit")
    max_output_bytes = integer(arguments[6], label + " output byte limit")
    parent_device = integer(arguments[7], label + " parent device")
    parent_inode = integer(arguments[8], label + " parent inode")
    parent_mode = integer(arguments[9], label + " parent mode")
    if max_file_bytes > MAX_REPAIR_MOVE_BYTES:
        fail(label + " file byte limit exceeds the compiled boundary")
    if max_entries > MAX_CUTOVER_SNAPSHOT_ENTRIES:
        fail(label + " entry limit exceeds the compiled boundary")
    if max_depth > MAX_CUTOVER_SNAPSHOT_DEPTH:
        fail(label + " depth limit exceeds the compiled boundary")
    if max_total_bytes > MAX_CUTOVER_SNAPSHOT_OUTPUT_BYTES:
        fail(label + " aggregate byte limit exceeds the compiled boundary")
    if max_output_bytes > MAX_CUTOVER_SNAPSHOT_OUTPUT_BYTES:
        fail(label + " output byte limit exceeds the compiled boundary")
    parent = require_cutover_snapshot_directory(
        os.fstat(3),
        parent_device,
        parent_inode,
        parent_mode,
        label + " parent",
    )
    return (
        name,
        include_bytes,
        max_file_bytes,
        max_output_bytes,
        parent,
        {
            "entries": 0,
            "aggregate_bytes": 0,
            "max_entries": max_entries,
            "max_depth": max_depth,
            "max_total_bytes": max_total_bytes,
        },
    )


def snapshot_tree(arguments):
    (
        name,
        include_bytes,
        max_file_bytes,
        max_output_bytes,
        parent,
        budget,
    ) = parse_cutover_snapshot_request(arguments, "snapshot-tree")
    parent_snapshot = directory_snapshot(parent)
    entry = cutover_snapshot_named_entry(
        3, name, include_bytes, max_file_bytes, budget
    )
    require_directory_snapshot(
        require_cutover_snapshot_directory(
            os.fstat(3),
            parent.st_dev,
            parent.st_ino,
            stat.S_IMODE(parent.st_mode),
            "snapshot-tree parent",
        ),
        parent_snapshot,
        "snapshot-tree parent",
    )
    result = {
        "protocol": PROTOCOL,
        "operation": "snapshot-tree",
        "entry": entry,
        "entryCount": str(budget["entries"]),
        "aggregateBytes": str(budget["aggregate_bytes"]),
        "treeDigest": (
            cutover_snapshot_tree_digest(entry)
            if entry["kind"] == "directory"
            else None
        ),
        "parentDevice": str(parent.st_dev),
        "parentInode": str(parent.st_ino),
        "parentMode": str(stat.S_IMODE(parent.st_mode)),
    }
    encoded = json.dumps(
        result,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(encoded) > max_output_bytes:
        fail("snapshot-tree output exceeds the requested byte boundary")
    sys.stdout.buffer.write(encoded)


def require_cutover_snapshot_tree_digest(
    descriptor,
    name,
    expected_digest,
    max_file_bytes,
    max_entries,
    max_depth,
    max_total_bytes,
    expected_mode,
    label,
):
    expected_digest = sha256_digest(expected_digest, label + " digest")
    held_value = os.fstat(descriptor)
    opened = require_cutover_snapshot_directory(
        held_value,
        held_value.st_dev,
        held_value.st_ino,
        expected_mode,
        label,
    )
    budget = {
        "entries": 1,
        "aggregate_bytes": 0,
        "max_entries": max_entries,
        "max_depth": max_depth,
        "max_total_bytes": max_total_bytes,
    }
    entry = cutover_snapshot_directory(
        descriptor,
        name,
        opened,
        False,
        max_file_bytes,
        budget,
        0,
    )
    if cutover_snapshot_tree_digest(entry) != expected_digest:
        fail(label + " tree digest changed")
    return entry


def directory_child_proof(arguments):
    if len(arguments) != 5:
        fail(
            "directory-child-proof requires one name, one parent generation, and one child generation"
        )
    name = entry_name(arguments[0], "directory child name")
    parent_device = integer(arguments[1], "directory child parent device")
    parent_inode = integer(arguments[2], "directory child parent inode")
    child_device = integer(arguments[3], "directory child device")
    child_inode = integer(arguments[4], "directory child inode")
    parent = require_directory(
        3, parent_device, parent_inode, "directory child parent"
    )
    if parent.st_uid != os.getuid() or stat.S_IMODE(parent.st_mode) != 0o700:
        fail("directory child parent is not an exact private current-user directory")
    child = require_private_directory_generation(
        os.fstat(4),
        child_device,
        child_inode,
        0o700,
        os.getuid(),
        "held directory child",
    )
    parent_snapshot = directory_snapshot(parent)
    child_snapshot = directory_snapshot(child)
    named_before = require_named_private_directory_generation(
        3,
        name,
        child_device,
        child_inode,
        0o700,
        os.getuid(),
        "named directory child",
    )
    require_directory_snapshot(
        named_before, child_snapshot, "named directory child"
    )
    repair_move_test_pause(
        "after-directory-child-proof-open-before-revalidation",
        "directory-child-proof",
        name,
        "",
    )
    parent_after = require_directory(
        3, parent_device, parent_inode, "directory child parent"
    )
    if parent_after.st_uid != os.getuid() or stat.S_IMODE(parent_after.st_mode) != 0o700:
        fail("directory child parent is not an exact private current-user directory")
    require_directory_snapshot(
        parent_after, parent_snapshot, "directory child parent"
    )
    child_after = require_private_directory_generation(
        os.fstat(4),
        child_device,
        child_inode,
        0o700,
        os.getuid(),
        "held directory child",
    )
    require_directory_snapshot(
        child_after, child_snapshot, "held directory child"
    )
    named_after = require_named_private_directory_generation(
        3,
        name,
        child_device,
        child_inode,
        0o700,
        os.getuid(),
        "named directory child",
    )
    require_directory_snapshot(
        named_after, child_snapshot, "named directory child"
    )
    sys.stdout.write(
        json.dumps(
            {
                "protocol": PROTOCOL,
                "operation": "directory-child-proof",
                "name": name,
                "parentDevice": str(parent_device),
                "parentInode": str(parent_inode),
                "parentMode": str(0o700),
                "childDevice": str(child_device),
                "childInode": str(child_inode),
                "childMode": str(0o700),
                "uid": str(os.getuid()),
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    )


def require_private_batch_file(
    value,
    max_file_bytes,
    label,
    allowed_link_counts=(1,),
    allow_empty=False,
    allowed_modes=(0o600,),
):
    if not stat.S_ISREG(value.st_mode):
        fail(label + " is not a regular file")
    if value.st_uid != os.getuid():
        fail(label + " is not owned by the current user")
    if stat.S_IMODE(value.st_mode) not in allowed_modes:
        fail(label + " has an unsupported exact mode")
    if value.st_nlink not in allowed_link_counts:
        fail(label + " has an unsupported exact link count")
    if value.st_size < 0 or (not allow_empty and value.st_size == 0) or value.st_size > max_file_bytes:
        fail(label + " exceeds the requested per-file byte boundary")
    return value


def require_private_batch_directory(value, label):
    if not stat.S_ISDIR(value.st_mode):
        fail(label + " is not a directory")
    if value.st_uid != os.getuid():
        fail(label + " is not owned by the current user")
    if stat.S_IMODE(value.st_mode) != 0o700:
        fail(label + " is not exact mode 0700")
    return value


def private_batch_names_digest(names):
    encoded = (
        json.dumps(
            names,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        + "\n"
    ).encode("utf-8", "strict")
    return hashlib.sha256(encoded).hexdigest()


def private_batch_request(
    max_request_bytes, max_inventory_entries, max_selected_entries
):
    try:
        raw = sys.stdin.buffer.read(max_request_bytes + 1)
    except OSError as error:
        fail("private batch request cannot be read: " + error.strerror)
    if not raw or len(raw) > max_request_bytes:
        fail("private batch request exceeds its byte boundary")
    try:
        text = raw.decode("utf-8", "strict")
        request = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail("private batch request is not canonical UTF-8 JSON")
    if (
        not isinstance(request, dict)
        or sorted(request.keys())
        != [
            "expectedDirectoryNames",
            "expectedInventoryDigest",
            "expectedNameCount",
            "expectedNamesDigest",
            "includeBytes",
            "returnInventory",
            "schemaVersion",
            "selectedFileNames",
        ]
        or request.get("schemaVersion") != 1
        or not isinstance(request.get("includeBytes"), bool)
        or not isinstance(request.get("returnInventory"), bool)
        or not isinstance(request.get("expectedDirectoryNames"), list)
        or not isinstance(request.get("selectedFileNames"), list)
    ):
        fail("private batch request shape is invalid")
    canonical = (
        json.dumps(
            request,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        + "\n"
    ).encode("utf-8", "strict")
    if raw != canonical:
        fail("private batch request is not canonical JSON")
    expected_name_count = request["expectedNameCount"]
    expected_names_digest = request["expectedNamesDigest"]
    expected_inventory_digest = request["expectedInventoryDigest"]
    if expected_name_count is not None and (
        type(expected_name_count) is not int
        or expected_name_count < 0
        or expected_name_count > max_inventory_entries
    ):
        fail("private batch expected name count is invalid")
    for value, label in (
        (expected_names_digest, "private batch expected names digest"),
        (expected_inventory_digest, "private batch expected inventory digest"),
    ):
        if value is not None:
            sha256_digest(value, label)
    if (expected_name_count is None) != (expected_names_digest is None):
        fail("private batch expected name identity is incomplete")
    expected_directories = []
    for candidate in request["expectedDirectoryNames"]:
        if not isinstance(candidate, str):
            fail("private batch expected directory name is not a string")
        name, encoded_name = cutover_snapshot_name(
            candidate, "private batch expected directory name"
        )
        expected_directories.append((encoded_name, name))
    canonical_directories = sorted(
        expected_directories, key=lambda value: value[0]
    )
    if expected_directories != canonical_directories or len(
        {name for _encoded, name in expected_directories}
    ) != len(expected_directories):
        fail(
            "private batch expected directory names are not unique canonical byte order"
        )
    if len(expected_directories) > max_inventory_entries:
        fail("private batch expected directories exceed the inventory boundary")
    selected = []
    for candidate in request["selectedFileNames"]:
        if not isinstance(candidate, str):
            fail("private batch selected file name is not a string")
        name, encoded_name = cutover_snapshot_name(
            candidate, "private batch selected file name"
        )
        selected.append((encoded_name, name))
    canonical_selected = sorted(selected, key=lambda value: value[0])
    if selected != canonical_selected or len(
        {name for _encoded, name in selected}
    ) != len(selected):
        fail(
            "private batch selected file names are not unique canonical byte order"
        )
    if len(selected) > max_selected_entries:
        fail("private batch selected files exceed the selected entry boundary")
    if {name for _encoded, name in expected_directories}.intersection(
        name for _encoded, name in selected
    ):
        fail("private batch directory and selected file names overlap")
    inventory_only = expected_inventory_digest is None
    if inventory_only and (
        not request["returnInventory"]
        or request["includeBytes"]
        or len(selected) != 0
    ):
        fail(
            "private batch initial inventory must return metadata without selected files"
        )
    if not inventory_only and (
        expected_name_count is None or expected_names_digest is None
    ):
        fail("private batch selected read lacks an exact full name identity")
    return {
        "raw": raw,
        "include_bytes": request["includeBytes"],
        "return_inventory": request["returnInventory"],
        "expected_name_count": expected_name_count,
        "expected_names_digest": expected_names_digest,
        "expected_inventory_digest": expected_inventory_digest,
        "expected_directory_names": [
            name for _encoded, name in expected_directories
        ],
        "selected_file_names": [name for _encoded, name in selected],
    }


def private_batch_directory_names(
    descriptor, max_entries, max_encoded_name_bytes, label
):
    names = []
    encoded_name_bytes = 0
    try:
        with os.scandir(descriptor) as iterator:
            for candidate in iterator:
                if len(names) >= max_entries:
                    fail(label + " exceeds the requested entry boundary")
                name, encoded_name = cutover_snapshot_name(
                    candidate.name, label + " entry"
                )
                encoded_name_bytes += len(encoded_name)
                if encoded_name_bytes > max_encoded_name_bytes:
                    fail(label + " exceeds the requested encoded name boundary")
                names.append((encoded_name, name))
    except OSError as error:
        fail(label + " cannot be listed: " + error.strerror)
    names.sort(key=lambda value: value[0])
    return names, encoded_name_bytes


def private_batch_identity_receipt(name, kind, identity):
    return {
        "name": name,
        "kind": kind,
        "device": str(identity[0]),
        "inode": str(identity[1]),
        "mode": str(identity[2]),
        "linkCount": str(identity[3]),
        "uid": str(identity[4]),
        "gid": str(identity[5]),
        "size": str(identity[6]),
        "mtimeNs": str(identity[7]),
        "ctimeNs": str(identity[8]),
    }


def private_batch_parent_receipt(identity):
    return {
        "parentDevice": str(identity[0]),
        "parentInode": str(identity[1]),
        "parentMode": str(stat.S_IMODE(identity[2])),
        "parentUid": str(identity[3]),
        "parentGid": str(identity[4]),
        "parentLinkCount": str(identity[5]),
        "parentSize": str(identity[6]),
        "parentMtimeNs": str(identity[7]),
        "parentCtimeNs": str(identity[8]),
    }


def private_batch_open_identity(
    parent_descriptor,
    name,
    kind,
    max_file_bytes,
    expected_device,
    allowed_file_link_counts=(1,),
    allow_empty=False,
    allowed_file_modes=(0o600,),
):
    try:
        named_before = lstat_at(parent_descriptor, name)
    except OSError as error:
        fail("private batch entry cannot be inspected: " + error.strerror)
    if kind == "directory":
        require_private_batch_directory(named_before, "private batch directory entry")
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    else:
        require_private_batch_file(
            named_before,
            max_file_bytes,
            "private batch file entry",
            allowed_file_link_counts,
            allow_empty,
            allowed_file_modes,
        )
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    if named_before.st_dev != expected_device:
        fail("private batch entry is not on its parent device")
    admitted = authority_file_snapshot(named_before)
    descriptor = None
    try:
        descriptor = os.open(name, flags, dir_fd=parent_descriptor)
        opened = os.fstat(descriptor)
        if kind == "directory":
            require_private_batch_directory(
                opened, "opened private batch directory entry"
            )
        else:
            require_private_batch_file(
                opened,
                max_file_bytes,
                "opened private batch file entry",
                allowed_file_link_counts,
                allow_empty,
                allowed_file_modes,
            )
        if opened.st_dev != expected_device:
            fail("opened private batch entry is not on its parent device")
        if authority_file_snapshot(opened) != admitted:
            fail("private batch entry opened a different generation")
        try:
            named_after = lstat_at(parent_descriptor, name)
        except OSError as error:
            fail(
                "private batch entry cannot be re-inspected after open: "
                + error.strerror
            )
        if kind == "directory":
            require_private_batch_directory(
                named_after, "private batch directory entry"
            )
        else:
            require_private_batch_file(
                named_after,
                max_file_bytes,
                "private batch file entry",
                allowed_file_link_counts,
                allow_empty,
                allowed_file_modes,
            )
        if named_after.st_dev != expected_device:
            fail("private batch entry is not on its parent device")
        if authority_file_snapshot(named_after) != admitted:
            fail("private batch entry changed during descriptor admission")
        return admitted
    finally:
        if descriptor is not None:
            os.close(descriptor)


def private_batch_inventory_digest(entries, parent_identity):
    digest = hashlib.sha256()
    digest.update(
        json.dumps(
            private_batch_parent_receipt(parent_identity),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8", "strict")
    )
    digest.update(b"\n")
    for _encoded_name, name, kind, identity in entries:
        digest.update(
            json.dumps(
                private_batch_identity_receipt(name, kind, identity),
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8", "strict")
        )
        digest.update(b"\n")
    return digest.hexdigest()


def private_batch_inventory(
    descriptor,
    expected_directory_names,
    max_entries,
    max_encoded_name_bytes,
    max_file_bytes,
    max_inventory_total_bytes,
    parent_identity,
    allowed_file_link_counts=(1,),
    allow_empty=False,
    allowed_file_modes=(0o600,),
):
    names, encoded_name_bytes = private_batch_directory_names(
        descriptor,
        max_entries,
        max_encoded_name_bytes,
        "private batch directory",
    )
    expected_directories = set(expected_directory_names)
    admitted_directories = set()
    entries = []
    total_file_bytes = 0
    for encoded_name, name in names:
        try:
            named = lstat_at(descriptor, name)
        except OSError as error:
            fail("private batch entry cannot be inspected: " + error.strerror)
        if stat.S_ISDIR(named.st_mode):
            if name not in expected_directories:
                fail("private batch contains an unexpected directory entry")
            kind = "directory"
            admitted_directories.add(name)
        else:
            if name in expected_directories:
                fail("private batch expected directory is not a directory")
            kind = "file"
        identity = private_batch_open_identity(
            descriptor,
            name,
            kind,
            max_file_bytes,
            parent_identity[0],
            allowed_file_link_counts,
            allow_empty,
            allowed_file_modes,
        )
        if kind == "file":
            total_file_bytes += identity[6]
            if total_file_bytes > max_inventory_total_bytes:
                fail(
                    "private batch inventory exceeds the requested total byte boundary"
                )
        entries.append((encoded_name, name, kind, identity))
    if admitted_directories != expected_directories:
        fail("private batch expected directory set is incomplete")
    ordered_names = [name for _encoded_name, name in names]
    return {
        "entries": entries,
        "encoded_name_bytes": encoded_name_bytes,
        "name_count": len(ordered_names),
        "names_digest": private_batch_names_digest(ordered_names),
        "inventory_digest": private_batch_inventory_digest(
            entries, parent_identity
        ),
        "total_file_bytes": total_file_bytes,
    }


def private_batch_entry_receipt(name, identity, digest, bytes_base64=None):
    result = private_batch_identity_receipt(name, "file", identity)
    result["digest"] = digest
    if bytes_base64 is not None:
        result["bytesBase64"] = bytes_base64
    return result


def private_batch_projected_output_bytes(
    inventory_entries,
    selected_names,
    selected_identities,
    include_bytes,
    return_inventory,
):
    projected = 2048
    if return_inventory:
        for _encoded_name, name, kind, identity in inventory_entries:
            projected += len(
                json.dumps(
                    private_batch_identity_receipt(name, kind, identity),
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8", "strict")
            ) + 1
    for name, identity in zip(selected_names, selected_identities):
        skeleton = private_batch_entry_receipt(
            name,
            identity,
            "0" * 64,
            "" if include_bytes else None,
        )
        projected += len(
            json.dumps(
                skeleton,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8", "strict")
        ) + 1
        if include_bytes:
            projected += 4 * ((identity[6] + 2) // 3)
    return projected


def encode_private_batch_receipt(result):
    result["encodedOutputBytes"] = "0"
    for _attempt in range(8):
        encoded = json.dumps(
            result,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8", "strict")
        encoded_size = str(len(encoded))
        if result["encodedOutputBytes"] == encoded_size:
            return encoded
        result["encodedOutputBytes"] = encoded_size
    fail("private batch encoded receipt size did not converge")


def private_file_batch_read_impl(
    arguments,
    operation_name,
    allowed_file_link_counts,
    allow_empty=False,
    allowed_file_modes=(0o600,),
):
    if len(arguments) != 10:
        fail(
            "private-file-batch-read requires eight bounds and one parent generation"
        )
    max_inventory_entries = integer(
        arguments[0], "private batch inventory entry limit"
    )
    max_selected_entries = integer(
        arguments[1], "private batch selected entry limit"
    )
    max_encoded_name_bytes = integer(
        arguments[2], "private batch encoded name byte limit"
    )
    max_request_bytes = integer(arguments[3], "private batch request byte limit")
    max_output_bytes = integer(arguments[4], "private batch output byte limit")
    max_file_bytes = integer(arguments[5], "private batch per-file byte limit")
    max_inventory_total_bytes = integer(
        arguments[6], "private batch inventory total byte limit"
    )
    max_selected_total_bytes = integer(
        arguments[7], "private batch selected total byte limit"
    )
    parent_device = integer(arguments[8], "private batch parent device")
    parent_inode = integer(arguments[9], "private batch parent inode")
    if max_inventory_entries > MAX_PRIVATE_BATCH_INVENTORY_ENTRIES:
        fail("private batch inventory entry limit exceeds the compiled boundary")
    if max_selected_entries > MAX_PRIVATE_BATCH_SELECTED_ENTRIES:
        fail("private batch selected entry limit exceeds the compiled boundary")
    if max_selected_entries > max_inventory_entries:
        fail("private batch selected entry limit exceeds its inventory limit")
    if (
        max_encoded_name_bytes == 0
        or max_encoded_name_bytes > MAX_PRIVATE_BATCH_INVENTORY_NAME_BYTES
    ):
        fail("private batch encoded name limit exceeds the compiled boundary")
    if max_request_bytes == 0 or max_request_bytes > MAX_PRIVATE_BATCH_REQUEST_BYTES:
        fail("private batch request byte limit exceeds the compiled boundary")
    if max_output_bytes == 0 or max_output_bytes > MAX_PRIVATE_BATCH_OUTPUT_BYTES:
        fail("private batch output byte limit exceeds the compiled boundary")
    if max_file_bytes > MAX_REPAIR_MOVE_BYTES:
        fail("private batch per-file byte limit exceeds the compiled boundary")
    if max_inventory_total_bytes > MAX_PRIVATE_BATCH_INVENTORY_TOTAL_BYTES:
        fail("private batch inventory total limit exceeds the compiled boundary")
    if max_selected_total_bytes > MAX_PRIVATE_BATCH_SELECTED_TOTAL_BYTES:
        fail("private batch selected total limit exceeds the compiled boundary")
    parent = require_directory(
        3, parent_device, parent_inode, "private batch parent"
    )
    parent_snapshot = directory_snapshot(parent)
    request = private_batch_request(
        max_request_bytes,
        max_inventory_entries,
        max_selected_entries,
    )
    inventory = private_batch_inventory(
        3,
        request["expected_directory_names"],
        max_inventory_entries,
        max_encoded_name_bytes,
        max_file_bytes,
        max_inventory_total_bytes,
        parent_snapshot,
        allowed_file_link_counts,
        allow_empty,
        allowed_file_modes,
    )
    if (
        request["expected_name_count"] is not None
        and inventory["name_count"] != request["expected_name_count"]
    ):
        fail("private batch full name count changed")
    if (
        request["expected_names_digest"] is not None
        and inventory["names_digest"] != request["expected_names_digest"]
    ):
        fail("private batch full name digest changed")
    if (
        request["expected_inventory_digest"] is not None
        and inventory["inventory_digest"]
        != request["expected_inventory_digest"]
    ):
        fail("private batch full inventory identity changed")
    file_identities = {
        name: identity
        for _encoded_name, name, kind, identity in inventory["entries"]
        if kind == "file"
    }
    selected_identities = []
    selected_total_bytes = 0
    for name in request["selected_file_names"]:
        identity = file_identities.get(name)
        if identity is None:
            fail("private batch selected file is absent or not a regular file")
        selected_total_bytes += identity[6]
        if selected_total_bytes > max_selected_total_bytes:
            fail("private batch exceeds the requested selected byte boundary")
        selected_identities.append(identity)
    if private_batch_projected_output_bytes(
        inventory["entries"],
        request["selected_file_names"],
        selected_identities,
        request["include_bytes"],
        request["return_inventory"],
    ) > max_output_bytes:
        fail("private batch exceeds the requested output byte boundary")
    require_directory_snapshot(
        require_directory(3, parent_device, parent_inode, "private batch parent"),
        parent_snapshot,
        "private batch parent",
    )
    repair_move_test_pause(
        "after-private-file-batch-preflight",
        operation_name,
        "",
        "",
    )
    entries = []
    for name, identity in zip(
        request["selected_file_names"], selected_identities
    ):
        try:
            named_before = lstat_at(3, name)
        except OSError as error:
            fail("private batch entry cannot be re-inspected: " + error.strerror)
        require_private_batch_file(
            named_before,
            max_file_bytes,
            "private batch entry",
            allowed_file_link_counts,
            allow_empty,
            allowed_file_modes,
        )
        if authority_file_snapshot(named_before) != identity:
            fail("private batch entry changed after aggregate admission")
        descriptor = None
        try:
            descriptor = os.open(
                name,
                os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                dir_fd=3,
            )
            opened_before = require_private_batch_file(
                os.fstat(descriptor),
                max_file_bytes,
                "opened private batch entry",
                allowed_file_link_counts,
                allow_empty,
                allowed_file_modes,
            )
            if authority_file_snapshot(opened_before) != identity:
                fail("private batch entry opened a different generation")
            repair_move_test_pause(
                "after-private-file-batch-open-before-read",
                operation_name,
                name,
                "",
            )
            digest = hashlib.sha256()
            retained = []
            offset = 0
            while offset < identity[6]:
                chunk = os.pread(
                    descriptor, min(64 * 1024, identity[6] - offset), offset
                )
                if not chunk:
                    fail("private batch entry changed size while being read")
                digest.update(chunk)
                if request["include_bytes"]:
                    retained.append(chunk)
                offset += len(chunk)
            if os.pread(descriptor, 1, identity[6]):
                fail("private batch entry grew while being read")
            opened_after = require_private_batch_file(
                os.fstat(descriptor),
                max_file_bytes,
                "opened private batch entry",
                allowed_file_link_counts,
                allow_empty,
                allowed_file_modes,
            )
            if authority_file_snapshot(opened_after) != identity:
                fail("private batch entry changed while being read")
            try:
                named_after = lstat_at(3, name)
            except OSError as error:
                fail(
                    "private batch entry cannot be inspected after read: "
                    + error.strerror
                )
            require_private_batch_file(
                named_after,
                max_file_bytes,
                "private batch entry",
                allowed_file_link_counts,
                allow_empty,
                allowed_file_modes,
            )
            if authority_file_snapshot(named_after) != identity:
                fail("private batch entry changed during admission")
            entries.append(
                private_batch_entry_receipt(
                    name,
                    identity,
                    digest.hexdigest(),
                    (
                        base64.b64encode(b"".join(retained)).decode("ascii")
                        if request["include_bytes"]
                        else None
                    ),
                )
            )
        finally:
            if descriptor is not None:
                os.close(descriptor)
    repair_move_test_pause(
        "after-private-file-batch-read-before-revalidation",
        operation_name,
        "",
        "",
    )
    final_inventory = private_batch_inventory(
        3,
        request["expected_directory_names"],
        max_inventory_entries,
        max_encoded_name_bytes,
        max_file_bytes,
        max_inventory_total_bytes,
        parent_snapshot,
        allowed_file_link_counts,
        allow_empty,
        allowed_file_modes,
    )
    if final_inventory != inventory:
        fail("private batch full inventory changed during admission")
    require_directory_snapshot(
        require_directory(3, parent_device, parent_inode, "private batch parent"),
        parent_snapshot,
        "private batch parent",
    )
    result = {
        "protocol": PROTOCOL,
        "operation": operation_name,
        "requestDigest": hashlib.sha256(request["raw"]).hexdigest(),
        "includeBytes": request["include_bytes"],
        "returnInventory": request["return_inventory"],
        "inventoryEntryCount": str(inventory["name_count"]),
        "inventoryEncodedNameBytes": str(inventory["encoded_name_bytes"]),
        "inventoryNamesDigest": inventory["names_digest"],
        "inventoryDigest": inventory["inventory_digest"],
        "inventoryTotalFileBytes": str(inventory["total_file_bytes"]),
        "selectedEntryCount": str(len(entries)),
        "selectedTotalBytes": str(selected_total_bytes),
        **private_batch_parent_receipt(parent_snapshot),
        "inventoryEntries": (
            [
                private_batch_identity_receipt(name, kind, identity)
                for _encoded_name, name, kind, identity in inventory["entries"]
            ]
            if request["return_inventory"]
            else []
        ),
        "selectedEntries": entries,
    }
    encoded = encode_private_batch_receipt(result)
    if len(encoded) > max_output_bytes:
        fail("private batch exceeds the requested output byte boundary")
    sys.stdout.buffer.write(encoded)


def private_file_batch_read(arguments):
    private_file_batch_read_impl(arguments, "private-file-batch-read", (1,))


def private_file_batch_read_allow_empty(arguments):
    private_file_batch_read_impl(
        arguments,
        "private-file-batch-read-allow-empty",
        (1,),
        True,
        (0o600, 0o640, 0o644),
    )


def private_lease_state_name(value, label):
    name, encoded = cutover_snapshot_name(value, label)
    parts = name.split(".")
    if (
        len(parts) != 3
        or parts[2] != "lease"
        or any(
            len(part) != 64
            or any(character not in "0123456789abcdef" for character in part)
            for part in parts[:2]
        )
    ):
        fail(label + " is not a canonical retired lease state name")
    return name, encoded


def private_lease_state_request(
    max_request_bytes, max_inventory_entries, max_selected_entries
):
    try:
        raw = sys.stdin.buffer.read(max_request_bytes + 1)
    except OSError as error:
        fail("private lease state request cannot be read: " + error.strerror)
    if not raw or len(raw) > max_request_bytes:
        fail("private lease state request exceeds its byte boundary")
    try:
        text = raw.decode("utf-8", "strict")
        request = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail("private lease state request is not canonical UTF-8 JSON")
    if (
        not isinstance(request, dict)
        or sorted(request.keys())
        != [
            "expectedInventoryDigest",
            "expectedNameCount",
            "expectedNamesDigest",
            "includeBytes",
            "returnInventory",
            "schemaVersion",
            "selectedDirectoryNames",
        ]
        or request.get("schemaVersion") != 1
        or not isinstance(request.get("includeBytes"), bool)
        or not isinstance(request.get("returnInventory"), bool)
        or not isinstance(request.get("selectedDirectoryNames"), list)
    ):
        fail("private lease state request shape is invalid")
    canonical = (
        json.dumps(
            request,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        + "\n"
    ).encode("utf-8", "strict")
    if raw != canonical:
        fail("private lease state request is not canonical JSON")
    expected_name_count = request["expectedNameCount"]
    expected_names_digest = request["expectedNamesDigest"]
    expected_inventory_digest = request["expectedInventoryDigest"]
    if expected_name_count is not None and (
        type(expected_name_count) is not int
        or expected_name_count < 0
        or expected_name_count > max_inventory_entries
    ):
        fail("private lease state expected name count is invalid")
    for value, label in (
        (expected_names_digest, "private lease state expected names digest"),
        (
            expected_inventory_digest,
            "private lease state expected inventory digest",
        ),
    ):
        if value is not None:
            sha256_digest(value, label)
    if (expected_name_count is None) != (expected_names_digest is None):
        fail("private lease state expected name identity is incomplete")
    selected = []
    for candidate in request["selectedDirectoryNames"]:
        if not isinstance(candidate, str):
            fail("private lease state selected directory name is not a string")
        name, encoded_name = private_lease_state_name(
            candidate, "private lease state selected directory name"
        )
        selected.append((encoded_name, name))
    canonical_selected = sorted(selected, key=lambda value: value[0])
    if selected != canonical_selected or len(
        {name for _encoded, name in selected}
    ) != len(selected):
        fail(
            "private lease state selected directory names are not unique canonical byte order"
        )
    if len(selected) > max_selected_entries:
        fail(
            "private lease state selected directories exceed the selected entry boundary"
        )
    inventory_only = expected_inventory_digest is None
    if inventory_only and (
        not request["returnInventory"]
        or request["includeBytes"]
        or len(selected) != 0
    ):
        fail(
            "private lease state initial inventory must return metadata without selected directories"
        )
    if not inventory_only and (
        expected_name_count is None or expected_names_digest is None
    ):
        fail("private lease state selected read lacks an exact full name identity")
    return {
        "raw": raw,
        "include_bytes": request["includeBytes"],
        "return_inventory": request["returnInventory"],
        "expected_name_count": expected_name_count,
        "expected_names_digest": expected_names_digest,
        "expected_inventory_digest": expected_inventory_digest,
        "selected_directory_names": [name for _encoded, name in selected],
    }


def private_lease_state_child_metadata(
    parent_descriptor, name, max_record_bytes, expected_device
):
    try:
        named_before = lstat_at(parent_descriptor, name)
    except OSError as error:
        fail("private lease state child cannot be inspected: " + error.strerror)
    require_private_batch_directory(
        named_before, "private lease state child directory"
    )
    if named_before.st_dev != expected_device:
        fail("private lease state child is not on its parent device")
    directory_identity = authority_file_snapshot(named_before)
    descriptor = None
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
            dir_fd=parent_descriptor,
        )
        opened = require_private_batch_directory(
            os.fstat(descriptor), "opened private lease state child directory"
        )
        if opened.st_dev != expected_device:
            fail("opened private lease state child is not on its parent device")
        if authority_file_snapshot(opened) != directory_identity:
            fail("private lease state child opened a different generation")
        child_names, _encoded_name_bytes = private_batch_directory_names(
            descriptor,
            2,
            len("lease.json".encode("utf-8")),
            "private lease state child directory",
        )
        ordered_child_names = [
            child_name for _encoded_name, child_name in child_names
        ]
        if ordered_child_names not in ([], ["lease.json"]):
            fail("private lease state child contains unsupported entries")
        record_identity = None
        if ordered_child_names:
            record_identity = private_batch_open_identity(
                descriptor,
                "lease.json",
                "file",
                max_record_bytes,
                expected_device,
            )
        child_names_after, _encoded_name_bytes = private_batch_directory_names(
            descriptor,
            2,
            len("lease.json".encode("utf-8")),
            "private lease state child directory",
        )
        if child_names_after != child_names:
            fail("private lease state child entries changed during admission")
        if authority_file_snapshot(os.fstat(descriptor)) != directory_identity:
            fail("private lease state child changed during admission")
        try:
            named_after = lstat_at(parent_descriptor, name)
        except OSError as error:
            fail(
                "private lease state child cannot be re-inspected: "
                + error.strerror
            )
        require_private_batch_directory(
            named_after, "private lease state child directory"
        )
        if named_after.st_dev != expected_device:
            fail("private lease state child is not on its parent device")
        if authority_file_snapshot(named_after) != directory_identity:
            fail("private lease state child changed during descriptor admission")
        return directory_identity, record_identity
    finally:
        if descriptor is not None:
            os.close(descriptor)


def private_lease_state_metadata(
    descriptor,
    max_entries,
    max_encoded_name_bytes,
    max_record_bytes,
    max_total_bytes,
    expected_device,
):
    names, encoded_name_bytes = private_batch_directory_names(
        descriptor,
        max_entries,
        max_encoded_name_bytes,
        "private lease state directory",
    )
    entries = []
    total_record_bytes = 0
    for encoded_name, candidate in names:
        name, canonical_encoded_name = private_lease_state_name(
            candidate, "private lease state directory entry"
        )
        if encoded_name != canonical_encoded_name:
            fail("private lease state directory entry changed encoding")
        directory_identity, record_identity = private_lease_state_child_metadata(
            descriptor, name, max_record_bytes, expected_device
        )
        if record_identity is not None:
            total_record_bytes += record_identity[6]
            if total_record_bytes > max_total_bytes:
                fail(
                    "private lease state inventory exceeds the requested total byte boundary"
                )
        entries.append(
            (encoded_name, name, directory_identity, record_identity)
        )
    ordered_names = [name for _encoded_name, name in names]
    return {
        "entries": entries,
        "encoded_name_bytes": encoded_name_bytes,
        "name_count": len(entries),
        "names_digest": private_batch_names_digest(ordered_names),
        "total_record_bytes": total_record_bytes,
    }


def private_lease_state_inventory_entry_receipt(
    name, directory_identity, record_identity, record_digest
):
    result = private_batch_identity_receipt(
        name, "lease-state-directory", directory_identity
    )
    result["record"] = (
        None
        if record_identity is None
        else {
            **private_batch_identity_receipt(
                "lease.json", "file", record_identity
            ),
            "digest": record_digest,
        }
    )
    return result


def private_lease_state_inventory_digest(entries, parent_identity):
    digest = hashlib.sha256()
    digest.update(
        json.dumps(
            private_batch_parent_receipt(parent_identity),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8", "strict")
    )
    digest.update(b"\n")
    for entry in entries:
        digest.update(
            json.dumps(
                entry,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8", "strict")
        )
        digest.update(b"\n")
    return digest.hexdigest()


def private_lease_state_projected_output_bytes(
    metadata_entries,
    selected_directory_names,
    include_bytes,
    return_inventory,
):
    selected = set(selected_directory_names)
    projected = 2_048
    for _encoded_name, name, directory_identity, record_identity in metadata_entries:
        skeleton = private_lease_state_inventory_entry_receipt(
            name,
            directory_identity,
            record_identity,
            None if record_identity is None else "0" * 64,
        )
        encoded_size = len(
            json.dumps(
                skeleton,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8", "strict")
        ) + 1
        if return_inventory:
            projected += encoded_size
        if name in selected:
            projected += encoded_size
            if include_bytes and record_identity is not None:
                projected += 4 * ((record_identity[6] + 2) // 3)
    return projected


def private_lease_state_read_inventory(
    parent_descriptor,
    metadata,
    selected_directory_names,
    include_bytes,
    max_record_bytes,
):
    selected = set(selected_directory_names)
    inventory_entries = []
    selected_entries = []
    for _encoded_name, name, directory_identity, record_identity in metadata[
        "entries"
    ]:
        descriptor = None
        record_descriptor = None
        try:
            descriptor = os.open(
                name,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                dir_fd=parent_descriptor,
            )
            child = require_private_batch_directory(
                os.fstat(descriptor),
                "opened private lease state child directory",
            )
            if authority_file_snapshot(child) != directory_identity:
                fail("private lease state child opened a different generation")
            child_names, _encoded_name_bytes = private_batch_directory_names(
                descriptor,
                2,
                len("lease.json".encode("utf-8")),
                "private lease state child directory",
            )
            expected_child_names = [] if record_identity is None else ["lease.json"]
            if [child_name for _encoded, child_name in child_names] != expected_child_names:
                fail("private lease state child entries changed before read")
            retained = []
            record_digest = None
            if record_identity is not None:
                record_descriptor = os.open(
                    "lease.json",
                    os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                    dir_fd=descriptor,
                )
                opened_record = require_private_batch_file(
                    os.fstat(record_descriptor),
                    max_record_bytes,
                    "opened private lease state record",
                )
                if authority_file_snapshot(opened_record) != record_identity:
                    fail("private lease state record opened a different generation")
                repair_move_test_pause(
                    "after-private-lease-state-batch-record-open-before-read",
                    "private-lease-state-batch-read",
                    name,
                    "",
                )
                digest = hashlib.sha256()
                decoder = codecs.getincrementaldecoder("utf-8")("strict")
                offset = 0
                while offset < record_identity[6]:
                    chunk = os.pread(
                        record_descriptor,
                        min(64 * 1024, record_identity[6] - offset),
                        offset,
                    )
                    if not chunk:
                        fail(
                            "private lease state record changed size while being read"
                        )
                    digest.update(chunk)
                    try:
                        decoder.decode(chunk, final=False)
                    except UnicodeDecodeError:
                        fail("private lease state record is not valid UTF-8")
                    if include_bytes and name in selected:
                        retained.append(chunk)
                    offset += len(chunk)
                try:
                    decoder.decode(b"", final=True)
                except UnicodeDecodeError:
                    fail("private lease state record is not valid UTF-8")
                if os.pread(record_descriptor, 1, record_identity[6]):
                    fail("private lease state record grew while being read")
                opened_after = require_private_batch_file(
                    os.fstat(record_descriptor),
                    max_record_bytes,
                    "opened private lease state record",
                )
                if authority_file_snapshot(opened_after) != record_identity:
                    fail("private lease state record changed while being read")
                try:
                    named_record = lstat_at(descriptor, "lease.json")
                except OSError as error:
                    fail(
                        "private lease state record cannot be re-inspected: "
                        + error.strerror
                    )
                require_private_batch_file(
                    named_record,
                    max_record_bytes,
                    "private lease state record",
                )
                if authority_file_snapshot(named_record) != record_identity:
                    fail("private lease state record changed during admission")
                record_digest = digest.hexdigest()
            child_names_after, _encoded_name_bytes = private_batch_directory_names(
                descriptor,
                2,
                len("lease.json".encode("utf-8")),
                "private lease state child directory",
            )
            if child_names_after != child_names:
                fail("private lease state child entries changed during read")
            if authority_file_snapshot(os.fstat(descriptor)) != directory_identity:
                fail("private lease state child changed during read")
            try:
                named_child = lstat_at(parent_descriptor, name)
            except OSError as error:
                fail(
                    "private lease state child cannot be re-inspected after read: "
                    + error.strerror
                )
            require_private_batch_directory(
                named_child, "private lease state child directory"
            )
            if authority_file_snapshot(named_child) != directory_identity:
                fail("private lease state child changed during admission")
            entry = private_lease_state_inventory_entry_receipt(
                name, directory_identity, record_identity, record_digest
            )
            inventory_entries.append(entry)
            if name in selected:
                selected_entry = dict(entry)
                if include_bytes and record_identity is not None:
                    selected_entry["record"] = dict(entry["record"])
                    selected_entry["record"]["bytesBase64"] = base64.b64encode(
                        b"".join(retained)
                    ).decode("ascii")
                selected_entries.append(selected_entry)
        finally:
            if record_descriptor is not None:
                os.close(record_descriptor)
            if descriptor is not None:
                os.close(descriptor)
    return inventory_entries, selected_entries


def private_lease_state_batch_read(arguments):
    if len(arguments) != 10:
        fail(
            "private-lease-state-batch-read requires eight bounds and one parent generation"
        )
    max_inventory_entries = integer(
        arguments[0], "private lease state inventory entry limit"
    )
    max_selected_entries = integer(
        arguments[1], "private lease state selected entry limit"
    )
    max_encoded_name_bytes = integer(
        arguments[2], "private lease state encoded name byte limit"
    )
    max_request_bytes = integer(
        arguments[3], "private lease state request byte limit"
    )
    max_output_bytes = integer(
        arguments[4], "private lease state output byte limit"
    )
    max_record_bytes = integer(
        arguments[5], "private lease state per-record byte limit"
    )
    max_inventory_total_bytes = integer(
        arguments[6], "private lease state inventory total byte limit"
    )
    max_selected_total_bytes = integer(
        arguments[7], "private lease state selected total byte limit"
    )
    parent_device = integer(arguments[8], "private lease state parent device")
    parent_inode = integer(arguments[9], "private lease state parent inode")
    if max_inventory_entries > MAX_PRIVATE_BATCH_INVENTORY_ENTRIES:
        fail("private lease state inventory entry limit exceeds the compiled boundary")
    if max_selected_entries > MAX_PRIVATE_BATCH_SELECTED_ENTRIES:
        fail("private lease state selected entry limit exceeds the compiled boundary")
    if max_selected_entries > max_inventory_entries:
        fail("private lease state selected entry limit exceeds its inventory limit")
    if (
        max_encoded_name_bytes == 0
        or max_encoded_name_bytes > MAX_PRIVATE_BATCH_INVENTORY_NAME_BYTES
    ):
        fail("private lease state encoded name limit exceeds the compiled boundary")
    if max_request_bytes == 0 or max_request_bytes > MAX_PRIVATE_BATCH_REQUEST_BYTES:
        fail("private lease state request limit exceeds the compiled boundary")
    if max_output_bytes == 0 or max_output_bytes > MAX_PRIVATE_BATCH_OUTPUT_BYTES:
        fail("private lease state output limit exceeds the compiled boundary")
    if max_record_bytes > MAX_REPAIR_MOVE_BYTES:
        fail("private lease state record limit exceeds the compiled boundary")
    if max_inventory_total_bytes > MAX_PRIVATE_BATCH_INVENTORY_TOTAL_BYTES:
        fail("private lease state inventory total limit exceeds the compiled boundary")
    if max_selected_total_bytes > MAX_PRIVATE_BATCH_SELECTED_TOTAL_BYTES:
        fail("private lease state selected total limit exceeds the compiled boundary")
    parent = require_directory(
        3, parent_device, parent_inode, "private lease state parent"
    )
    parent_snapshot = directory_snapshot(parent)
    request = private_lease_state_request(
        max_request_bytes,
        max_inventory_entries,
        max_selected_entries,
    )
    metadata = private_lease_state_metadata(
        3,
        max_inventory_entries,
        max_encoded_name_bytes,
        max_record_bytes,
        max_inventory_total_bytes,
        parent_device,
    )
    if (
        request["expected_name_count"] is not None
        and metadata["name_count"] != request["expected_name_count"]
    ):
        fail("private lease state full name count changed")
    if (
        request["expected_names_digest"] is not None
        and metadata["names_digest"] != request["expected_names_digest"]
    ):
        fail("private lease state full name digest changed")
    metadata_by_name = {
        name: (directory_identity, record_identity)
        for _encoded, name, directory_identity, record_identity in metadata[
            "entries"
        ]
    }
    selected_total_bytes = 0
    for name in request["selected_directory_names"]:
        selected = metadata_by_name.get(name)
        if selected is None:
            fail("private lease state selected directory is absent")
        record_identity = selected[1]
        if record_identity is not None:
            selected_total_bytes += record_identity[6]
            if selected_total_bytes > max_selected_total_bytes:
                fail(
                    "private lease state exceeds the requested selected byte boundary"
                )
    if private_lease_state_projected_output_bytes(
        metadata["entries"],
        request["selected_directory_names"],
        request["include_bytes"],
        request["return_inventory"],
    ) > max_output_bytes:
        fail("private lease state exceeds the requested output byte boundary")
    require_directory_snapshot(
        require_directory(
            3, parent_device, parent_inode, "private lease state parent"
        ),
        parent_snapshot,
        "private lease state parent",
    )
    repair_move_test_pause(
        "after-private-lease-state-batch-preflight",
        "private-lease-state-batch-read",
        "",
        "",
    )
    inventory_entries, selected_entries = private_lease_state_read_inventory(
        3,
        metadata,
        request["selected_directory_names"],
        request["include_bytes"],
        max_record_bytes,
    )
    inventory_digest = private_lease_state_inventory_digest(
        inventory_entries, parent_snapshot
    )
    if (
        request["expected_inventory_digest"] is not None
        and inventory_digest != request["expected_inventory_digest"]
    ):
        fail("private lease state full inventory identity changed")
    repair_move_test_pause(
        "after-private-lease-state-batch-read-before-revalidation",
        "private-lease-state-batch-read",
        "",
        "",
    )
    final_metadata = private_lease_state_metadata(
        3,
        max_inventory_entries,
        max_encoded_name_bytes,
        max_record_bytes,
        max_inventory_total_bytes,
        parent_device,
    )
    if final_metadata != metadata:
        fail("private lease state metadata changed during admission")
    require_directory_snapshot(
        require_directory(
            3, parent_device, parent_inode, "private lease state parent"
        ),
        parent_snapshot,
        "private lease state parent",
    )
    result = {
        "protocol": PROTOCOL,
        "operation": "private-lease-state-batch-read",
        "requestDigest": hashlib.sha256(request["raw"]).hexdigest(),
        "includeBytes": request["include_bytes"],
        "returnInventory": request["return_inventory"],
        "inventoryEntryCount": str(metadata["name_count"]),
        "inventoryEncodedNameBytes": str(metadata["encoded_name_bytes"]),
        "inventoryNamesDigest": metadata["names_digest"],
        "inventoryDigest": inventory_digest,
        "inventoryTotalRecordBytes": str(metadata["total_record_bytes"]),
        "selectedEntryCount": str(len(selected_entries)),
        "selectedTotalBytes": str(selected_total_bytes),
        **private_batch_parent_receipt(parent_snapshot),
        "inventoryEntries": (
            inventory_entries if request["return_inventory"] else []
        ),
        "selectedEntries": selected_entries,
    }
    encoded = encode_private_batch_receipt(result)
    if len(encoded) > max_output_bytes:
        fail("private lease state exceeds the requested output byte boundary")
    sys.stdout.buffer.write(encoded)


def require_retire_directory_topology_before(
    source_name,
    destination_name,
    source_device,
    source_inode,
    source_mode,
    source_uid,
    source_parent_device,
    source_parent_inode,
    destination_parent_device,
    destination_parent_inode,
    expected_snapshots=None,
):
    if (
        source_parent_device == destination_parent_device
        and source_parent_inode == destination_parent_inode
        and source_name == destination_name
    ):
        fail("retired source and destination must be distinct entries")
    if (
        source_device != source_parent_device
        or source_device != destination_parent_device
    ):
        fail("retired directory and both parents must share one device")
    source_parent = require_directory(
        3,
        source_parent_device,
        source_parent_inode,
        "retired source parent",
    )
    destination_parent = require_directory(
        4,
        destination_parent_device,
        destination_parent_inode,
        "retired destination parent",
    )
    held_source = require_private_directory_generation(
        os.fstat(5),
        source_device,
        source_inode,
        source_mode,
        source_uid,
        "held retired source directory",
    )
    named_source = require_named_private_directory_generation(
        3,
        source_name,
        source_device,
        source_inode,
        source_mode,
        source_uid,
        "retired source directory entry",
    )
    require_directory_snapshot(
        named_source,
        directory_snapshot(held_source),
        "retired source directory entry",
    )
    require_absent(4, destination_name, "retired directory destination")
    snapshots = (
        directory_snapshot(source_parent),
        directory_snapshot(destination_parent),
        directory_snapshot(held_source),
    )
    if expected_snapshots is not None:
        require_directory_snapshot(
            source_parent,
            expected_snapshots[0],
            "retired source parent",
        )
        require_directory_snapshot(
            destination_parent,
            expected_snapshots[1],
            "retired destination parent",
        )
        require_directory_snapshot(
            held_source,
            expected_snapshots[2],
            "held retired source directory",
        )
    return snapshots


def require_retire_directory_topology_after(
    source_name,
    destination_name,
    source_device,
    source_inode,
    source_mode,
    source_uid,
    source_parent_device,
    source_parent_inode,
    destination_parent_device,
    destination_parent_inode,
):
    require_directory(
        3,
        source_parent_device,
        source_parent_inode,
        "retired source parent",
    )
    require_directory(
        4,
        destination_parent_device,
        destination_parent_inode,
        "retired destination parent",
    )
    require_private_directory_generation(
        os.fstat(5),
        source_device,
        source_inode,
        source_mode,
        source_uid,
        "held retired source directory",
    )
    try:
        lstat_at(3, source_name)
    except FileNotFoundError:
        pass
    except OSError as error:
        fail("retired source directory cannot be checked: " + error.strerror)
    else:
        fail("retired source directory reappeared after exclusive rename")
    require_named_private_directory_generation(
        4,
        destination_name,
        source_device,
        source_inode,
        source_mode,
        source_uid,
        "retired directory destination",
    )


def retire_directory_durable(arguments):
    if len(arguments) != 15:
        fail(
            "retire-directory-durable requires two entry names, one exact directory identity, two parent generations, one tree digest, and four snapshot bounds"
        )
    source_name = entry_name(arguments[0], "retired source name")
    destination_name = entry_name(arguments[1], "retired destination name")
    source_device = integer(arguments[2], "retired source device")
    source_inode = integer(arguments[3], "retired source inode")
    source_mode = integer(arguments[4], "retired source mode")
    source_uid = integer(arguments[5], "retired source uid")
    source_parent_device = integer(arguments[6], "retired source parent device")
    source_parent_inode = integer(arguments[7], "retired source parent inode")
    destination_parent_device = integer(
        arguments[8], "retired destination parent device"
    )
    destination_parent_inode = integer(
        arguments[9], "retired destination parent inode"
    )
    expected_tree_digest = sha256_digest(
        arguments[10], "retired directory tree digest"
    )
    max_file_bytes = integer(
        arguments[11], "retired directory file byte limit"
    )
    max_entries = integer(arguments[12], "retired directory entry limit")
    max_depth = integer(arguments[13], "retired directory depth limit")
    max_total_bytes = integer(
        arguments[14], "retired directory aggregate byte limit"
    )
    if max_file_bytes > MAX_REPAIR_MOVE_BYTES:
        fail("retired directory file byte limit exceeds the compiled boundary")
    if max_entries == 0 or max_entries > MAX_CUTOVER_SNAPSHOT_ENTRIES:
        fail("retired directory entry limit exceeds the compiled boundary")
    if max_depth > MAX_CUTOVER_SNAPSHOT_DEPTH:
        fail("retired directory depth limit exceeds the compiled boundary")
    if max_total_bytes > MAX_CUTOVER_SNAPSHOT_OUTPUT_BYTES:
        fail("retired directory aggregate byte limit exceeds the compiled boundary")
    admitted_snapshots = require_retire_directory_topology_before(
        source_name,
        destination_name,
        source_device,
        source_inode,
        source_mode,
        source_uid,
        source_parent_device,
        source_parent_inode,
        destination_parent_device,
        destination_parent_inode,
    )
    require_cutover_snapshot_tree_digest(
        5,
        source_name,
        expected_tree_digest,
        max_file_bytes,
        max_entries,
        max_depth,
        max_total_bytes,
        source_mode,
        "held retired source directory",
    )
    require_retire_directory_topology_before(
        source_name,
        destination_name,
        source_device,
        source_inode,
        source_mode,
        source_uid,
        source_parent_device,
        source_parent_inode,
        destination_parent_device,
        destination_parent_inode,
        admitted_snapshots,
    )
    repair_move_test_pause(
        "before-retire-directory-syscall",
        "retire-directory-durable",
        source_name,
        destination_name,
    )
    require_retire_directory_topology_before(
        source_name,
        destination_name,
        source_device,
        source_inode,
        source_mode,
        source_uid,
        source_parent_device,
        source_parent_inode,
        destination_parent_device,
        destination_parent_inode,
        admitted_snapshots,
    )
    require_cutover_snapshot_tree_digest(
        5,
        source_name,
        expected_tree_digest,
        max_file_bytes,
        max_entries,
        max_depth,
        max_total_bytes,
        source_mode,
        "held retired source directory",
    )
    require_retire_directory_topology_before(
        source_name,
        destination_name,
        source_device,
        source_inode,
        source_mode,
        source_uid,
        source_parent_device,
        source_parent_inode,
        destination_parent_device,
        destination_parent_inode,
        admitted_snapshots,
    )
    native_rename_exclusive(source_name, destination_name)
    repair_move_test_pause(
        "after-retire-directory-before-destination-sync",
        "retire-directory-durable",
        source_name,
        destination_name,
    )
    require_retire_directory_topology_after(
        source_name,
        destination_name,
        source_device,
        source_inode,
        source_mode,
        source_uid,
        source_parent_device,
        source_parent_inode,
        destination_parent_device,
        destination_parent_inode,
    )
    require_cutover_snapshot_tree_digest(
        5,
        destination_name,
        expected_tree_digest,
        max_file_bytes,
        max_entries,
        max_depth,
        max_total_bytes,
        source_mode,
        "held retired source directory",
    )
    fsync_repair_directory(4, "retired destination parent")
    repair_move_test_pause(
        "after-retire-directory-destination-sync",
        "retire-directory-durable",
        source_name,
        destination_name,
    )
    require_retire_directory_topology_after(
        source_name,
        destination_name,
        source_device,
        source_inode,
        source_mode,
        source_uid,
        source_parent_device,
        source_parent_inode,
        destination_parent_device,
        destination_parent_inode,
    )
    require_cutover_snapshot_tree_digest(
        5,
        destination_name,
        expected_tree_digest,
        max_file_bytes,
        max_entries,
        max_depth,
        max_total_bytes,
        source_mode,
        "held retired source directory",
    )
    fsync_repair_directory(3, "retired source parent")
    repair_move_test_pause(
        "after-retire-directory-source-sync",
        "retire-directory-durable",
        source_name,
        destination_name,
    )
    require_retire_directory_topology_after(
        source_name,
        destination_name,
        source_device,
        source_inode,
        source_mode,
        source_uid,
        source_parent_device,
        source_parent_inode,
        destination_parent_device,
        destination_parent_inode,
    )
    require_cutover_snapshot_tree_digest(
        5,
        destination_name,
        expected_tree_digest,
        max_file_bytes,
        max_entries,
        max_depth,
        max_total_bytes,
        source_mode,
        "held retired source directory",
    )
    sys.stdout.write(
        json.dumps(
            {
                "protocol": PROTOCOL,
                "device": str(source_device),
                "inode": str(source_inode),
                "mode": str(source_mode),
                "uid": str(source_uid),
                "treeDigest": expected_tree_digest,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    )


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


def rename_generation_durable(arguments):
    if len(arguments) != 12:
        fail(
            "rename-durable requires two entry names, content identity, exact file metadata, and two directory generations"
        )
    source_name = entry_name(arguments[0], "source name")
    destination_name = entry_name(arguments[1], "destination name")
    source_device = integer(arguments[2], "source device")
    source_inode = integer(arguments[3], "source inode")
    expected_mode = integer(arguments[4], "source mode")
    expected_nlink = integer(arguments[5], "source link count")
    expected_size = integer(arguments[6], "source size")
    expected_digest = sha256_digest(arguments[7], "source digest")
    source_directory_device = integer(arguments[8], "source directory device")
    source_directory_inode = integer(arguments[9], "source directory inode")
    destination_directory_device = integer(
        arguments[10], "destination directory device"
    )
    destination_directory_inode = integer(
        arguments[11], "destination directory inode"
    )
    require_rename_topology_before(
        source_name,
        destination_name,
        source_device,
        source_inode,
        expected_mode,
        expected_nlink,
        expected_size,
        expected_digest,
        source_directory_device,
        source_directory_inode,
        destination_directory_device,
        destination_directory_inode,
    )
    repair_move_test_pause(
        "before-rename-syscall",
        "rename-durable",
        source_name,
        destination_name,
    )
    require_rename_topology_before(
        source_name,
        destination_name,
        source_device,
        source_inode,
        expected_mode,
        expected_nlink,
        expected_size,
        expected_digest,
        source_directory_device,
        source_directory_inode,
        destination_directory_device,
        destination_directory_inode,
    )
    native_rename_exclusive(source_name, destination_name)
    repair_move_test_pause(
        "after-rename-before-destination-sync",
        "rename-durable",
        source_name,
        destination_name,
    )
    require_rename_topology_after(
        source_name,
        destination_name,
        source_device,
        source_inode,
        expected_mode,
        expected_nlink,
        expected_size,
        expected_digest,
        source_directory_device,
        source_directory_inode,
        destination_directory_device,
        destination_directory_inode,
    )
    fsync_repair_directory(4, "repair destination directory")
    repair_move_test_pause(
        "after-destination-sync", "rename-durable", source_name, destination_name
    )
    require_rename_topology_after(
        source_name,
        destination_name,
        source_device,
        source_inode,
        expected_mode,
        expected_nlink,
        expected_size,
        expected_digest,
        source_directory_device,
        source_directory_inode,
        destination_directory_device,
        destination_directory_inode,
    )
    fsync_repair_directory(3, "repair source directory")
    repair_move_test_pause(
        "after-source-sync", "rename-durable", source_name, destination_name
    )
    require_rename_topology_after(
        source_name,
        destination_name,
        source_device,
        source_inode,
        expected_mode,
        expected_nlink,
        expected_size,
        expected_digest,
        source_directory_device,
        source_directory_inode,
        destination_directory_device,
        destination_directory_inode,
    )
    repair_move_test_pause(
        "after-postcheck", "rename-durable", source_name, destination_name
    )
    require_rename_topology_after(
        source_name,
        destination_name,
        source_device,
        source_inode,
        expected_mode,
        expected_nlink,
        expected_size,
        expected_digest,
        source_directory_device,
        source_directory_inode,
        destination_directory_device,
        destination_directory_inode,
    )
    sys.stdout.write(
        json.dumps(
            {
                "protocol": PROTOCOL,
                "device": str(source_device),
                "inode": str(source_inode),
                "size": str(expected_size),
                "digest": expected_digest,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    )


def exchange_generations_durable(arguments):
    if len(arguments) != 18:
        fail(
            "exchange-durable requires two entry names, two exact file identities, and two directory generations"
        )
    source_name = entry_name(arguments[0], "exchange source name")
    destination_name = entry_name(arguments[1], "exchange destination name")
    source_device = integer(arguments[2], "exchange source device")
    source_inode = integer(arguments[3], "exchange source inode")
    source_mode = integer(arguments[4], "exchange source mode")
    source_nlink = integer(arguments[5], "exchange source link count")
    source_size = integer(arguments[6], "exchange source size")
    source_digest = sha256_digest(arguments[7], "exchange source digest")
    destination_device = integer(arguments[8], "exchange destination device")
    destination_inode = integer(arguments[9], "exchange destination inode")
    destination_mode = integer(arguments[10], "exchange destination mode")
    destination_nlink = integer(arguments[11], "exchange destination link count")
    destination_size = integer(arguments[12], "exchange destination size")
    destination_digest = sha256_digest(
        arguments[13], "exchange destination digest"
    )
    source_directory_device = integer(
        arguments[14], "exchange source directory device"
    )
    source_directory_inode = integer(
        arguments[15], "exchange source directory inode"
    )
    destination_directory_device = integer(
        arguments[16], "exchange destination directory device"
    )
    destination_directory_inode = integer(
        arguments[17], "exchange destination directory inode"
    )
    source_identity = (
        source_device,
        source_inode,
        source_mode,
        source_nlink,
        source_size,
        source_digest,
    )
    destination_identity = (
        destination_device,
        destination_inode,
        destination_mode,
        destination_nlink,
        destination_size,
        destination_digest,
    )
    source_directory_identity = (
        source_directory_device,
        source_directory_inode,
    )
    destination_directory_identity = (
        destination_directory_device,
        destination_directory_inode,
    )
    destination_descriptor = None
    try:
        destination_descriptor = os.open(
            destination_name,
            os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
            dir_fd=4,
        )
        require_exchange_topology_before(
            source_name,
            destination_name,
            source_identity,
            destination_identity,
            source_directory_identity,
            destination_directory_identity,
            destination_descriptor,
        )
        repair_move_test_pause(
            "before-exchange-syscall",
            "exchange-durable",
            source_name,
            destination_name,
        )
        require_exchange_topology_before(
            source_name,
            destination_name,
            source_identity,
            destination_identity,
            source_directory_identity,
            destination_directory_identity,
            destination_descriptor,
        )
        native_rename_exchange(source_name, destination_name)
        repair_move_test_pause(
            "after-exchange-before-destination-sync",
            "exchange-durable",
            source_name,
            destination_name,
        )
        require_exchange_topology_after(
            source_name,
            destination_name,
            source_identity,
            destination_identity,
            source_directory_identity,
            destination_directory_identity,
            destination_descriptor,
        )
        fsync_repair_directory(4, "exchange destination directory")
        repair_move_test_pause(
            "after-exchange-destination-sync",
            "exchange-durable",
            source_name,
            destination_name,
        )
        require_exchange_topology_after(
            source_name,
            destination_name,
            source_identity,
            destination_identity,
            source_directory_identity,
            destination_directory_identity,
            destination_descriptor,
        )
        if (
            source_directory_device != destination_directory_device
            or source_directory_inode != destination_directory_inode
        ):
            fsync_repair_directory(3, "exchange source directory")
        repair_move_test_pause(
            "after-exchange-source-sync",
            "exchange-durable",
            source_name,
            destination_name,
        )
        require_exchange_topology_after(
            source_name,
            destination_name,
            source_identity,
            destination_identity,
            source_directory_identity,
            destination_directory_identity,
            destination_descriptor,
        )
        repair_move_test_pause(
            "after-exchange-postcheck",
            "exchange-durable",
            source_name,
            destination_name,
        )
        require_exchange_topology_after(
            source_name,
            destination_name,
            source_identity,
            destination_identity,
            source_directory_identity,
            destination_directory_identity,
            destination_descriptor,
        )
        sys.stdout.write(
            json.dumps(
                {
                    "protocol": PROTOCOL,
                    "sourceDevice": str(source_device),
                    "sourceInode": str(source_inode),
                    "sourceDigest": source_digest,
                    "destinationDevice": str(destination_device),
                    "destinationInode": str(destination_inode),
                    "destinationDigest": destination_digest,
                },
                sort_keys=True,
                separators=(",", ":"),
            )
        )
    finally:
        if destination_descriptor is not None:
            os.close(destination_descriptor)


def replace_generation_durable(arguments):
    if len(arguments) != 18:
        fail(
            "replace-durable requires two entry names, two exact file identities, and two directory generations"
        )
    source_name = entry_name(arguments[0], "replacement source name")
    destination_name = entry_name(arguments[1], "replacement destination name")
    source_device = integer(arguments[2], "replacement source device")
    source_inode = integer(arguments[3], "replacement source inode")
    source_mode = integer(arguments[4], "replacement source mode")
    source_nlink = integer(arguments[5], "replacement source link count")
    source_size = integer(arguments[6], "replacement source size")
    source_digest = sha256_digest(arguments[7], "replacement source digest")
    destination_device = integer(
        arguments[8], "replacement predecessor device"
    )
    destination_inode = integer(
        arguments[9], "replacement predecessor inode"
    )
    destination_mode = integer(arguments[10], "replacement predecessor mode")
    destination_nlink = integer(
        arguments[11], "replacement predecessor link count"
    )
    destination_size = integer(arguments[12], "replacement predecessor size")
    destination_digest = sha256_digest(
        arguments[13], "replacement predecessor digest"
    )
    source_directory_device = integer(
        arguments[14], "replacement source directory device"
    )
    source_directory_inode = integer(
        arguments[15], "replacement source directory inode"
    )
    destination_directory_device = integer(
        arguments[16], "replacement destination directory device"
    )
    destination_directory_inode = integer(
        arguments[17], "replacement destination directory inode"
    )
    source_identity = (
        source_device,
        source_inode,
        source_mode,
        source_nlink,
        source_size,
        source_digest,
    )
    destination_identity = (
        destination_device,
        destination_inode,
        destination_mode,
        destination_nlink,
        destination_size,
        destination_digest,
    )
    source_directory_identity = (
        source_directory_device,
        source_directory_inode,
    )
    destination_directory_identity = (
        destination_directory_device,
        destination_directory_inode,
    )
    admitted_snapshots = require_replace_topology_before(
        source_name,
        destination_name,
        source_identity,
        destination_identity,
        source_directory_identity,
        destination_directory_identity,
    )
    repair_move_test_pause(
        "before-replace-syscall",
        "replace-durable",
        source_name,
        destination_name,
    )
    require_replace_topology_before(
        source_name,
        destination_name,
        source_identity,
        destination_identity,
        source_directory_identity,
        destination_directory_identity,
        admitted_snapshots,
    )
    native_rename_replace(source_name, destination_name)
    repair_move_test_pause(
        "after-replace-before-destination-sync",
        "replace-durable",
        source_name,
        destination_name,
    )
    require_replace_topology_after(
        source_name,
        destination_name,
        source_identity,
        destination_identity,
        source_directory_identity,
        destination_directory_identity,
    )
    fsync_repair_directory(4, "replacement destination directory")
    repair_move_test_pause(
        "after-replace-destination-sync",
        "replace-durable",
        source_name,
        destination_name,
    )
    require_replace_topology_after(
        source_name,
        destination_name,
        source_identity,
        destination_identity,
        source_directory_identity,
        destination_directory_identity,
    )
    if source_directory_identity != destination_directory_identity:
        fsync_repair_directory(3, "replacement source directory")
    repair_move_test_pause(
        "after-replace-source-sync",
        "replace-durable",
        source_name,
        destination_name,
    )
    require_replace_topology_after(
        source_name,
        destination_name,
        source_identity,
        destination_identity,
        source_directory_identity,
        destination_directory_identity,
    )
    repair_move_test_pause(
        "after-replace-postcheck",
        "replace-durable",
        source_name,
        destination_name,
    )
    require_replace_topology_after(
        source_name,
        destination_name,
        source_identity,
        destination_identity,
        source_directory_identity,
        destination_directory_identity,
    )
    sys.stdout.write(
        json.dumps(
            {
                "protocol": PROTOCOL,
                "sourceDevice": str(source_device),
                "sourceInode": str(source_inode),
                "sourceMode": str(source_mode),
                "sourceLinkCount": str(source_nlink),
                "sourceSize": str(source_size),
                "sourceDigest": source_digest,
                "predecessorDevice": str(destination_device),
                "predecessorInode": str(destination_inode),
                "predecessorMode": str(destination_mode),
                "predecessorLinkCountBefore": str(destination_nlink),
                "predecessorLinkCountAfter": str(destination_nlink - 1),
                "predecessorSize": str(destination_size),
                "predecessorDigest": destination_digest,
                "sourceParentDevice": str(source_directory_device),
                "sourceParentInode": str(source_directory_inode),
                "destinationParentDevice": str(destination_directory_device),
                "destinationParentInode": str(destination_directory_inode),
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    )


def remove_generation_durable(arguments):
    if len(arguments) != 9:
        fail(
            "remove-durable requires one entry name, one exact file identity, and one parent generation"
        )
    name = entry_name(arguments[0], "removal entry name")
    file_device = integer(arguments[1], "removal file device")
    file_inode = integer(arguments[2], "removal file inode")
    file_mode = integer(arguments[3], "removal file mode")
    file_nlink = integer(arguments[4], "removal file link count")
    file_size = integer(arguments[5], "removal file size")
    file_digest = sha256_digest(arguments[6], "removal file digest")
    parent_device = integer(arguments[7], "removal parent device")
    parent_inode = integer(arguments[8], "removal parent inode")
    file_identity = (
        file_device,
        file_inode,
        file_mode,
        file_nlink,
        file_size,
        file_digest,
    )
    parent_identity = (parent_device, parent_inode)
    admitted_snapshots = require_remove_topology_before(
        name, file_identity, parent_identity
    )
    repair_move_test_pause(
        "before-remove-syscall", "remove-durable", name, ""
    )
    require_remove_topology_before(
        name, file_identity, parent_identity, admitted_snapshots
    )
    try:
        os.unlink(name, dir_fd=3)
    except OSError as error:
        fail("descriptor-relative removal failed: " + error.strerror)
    repair_move_test_pause(
        "after-remove-before-parent-sync", "remove-durable", name, ""
    )
    require_remove_topology_after(name, file_identity, parent_identity)
    fsync_repair_directory(3, "removal parent directory")
    repair_move_test_pause(
        "after-remove-parent-sync", "remove-durable", name, ""
    )
    require_remove_topology_after(name, file_identity, parent_identity)
    repair_move_test_pause(
        "after-remove-postcheck", "remove-durable", name, ""
    )
    require_remove_topology_after(name, file_identity, parent_identity)
    sys.stdout.write(
        json.dumps(
            {
                "protocol": PROTOCOL,
                "device": str(file_device),
                "inode": str(file_inode),
                "mode": str(file_mode),
                "linkCountBefore": str(file_nlink),
                "linkCountAfter": str(file_nlink - 1),
                "size": str(file_size),
                "digest": file_digest,
                "parentDevice": str(parent_device),
                "parentInode": str(parent_inode),
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    )


def parse_authority_file_identity(arguments, offset, label):
    return (
        integer(arguments[offset], label + " device"),
        integer(arguments[offset + 1], label + " inode"),
        integer(arguments[offset + 2], label + " mode"),
        integer(arguments[offset + 3], label + " link count"),
        integer(arguments[offset + 4], label + " uid"),
        integer(arguments[offset + 5], label + " gid"),
        integer(arguments[offset + 6], label + " size"),
        integer(arguments[offset + 7], label + " mtime nanoseconds"),
        integer(arguments[offset + 8], label + " ctime nanoseconds"),
        sha256_digest(arguments[offset + 9], label + " digest"),
    )


def parse_authority_parent_identity(arguments, offset, label):
    return (
        integer(arguments[offset], label + " device"),
        integer(arguments[offset + 1], label + " inode"),
        integer(arguments[offset + 2], label + " mode"),
        integer(arguments[offset + 3], label + " uid"),
    )


def authority_file_snapshot(value):
    return (
        value.st_dev,
        value.st_ino,
        stat.S_IMODE(value.st_mode),
        value.st_nlink,
        value.st_uid,
        value.st_gid,
        value.st_size,
        value.st_mtime_ns,
        value.st_ctime_ns,
    )


def authority_file_identity_from_value(value, digest):
    return authority_file_snapshot(value) + (digest,)


def require_authority_parent(descriptor, identity, label):
    try:
        value = os.fstat(descriptor)
    except OSError as error:
        fail(label + " descriptor cannot be inspected: " + error.strerror)
    expected_device, expected_inode, expected_mode, expected_uid = identity
    if not stat.S_ISDIR(value.st_mode):
        fail(label + " is not a directory")
    if value.st_dev != expected_device or value.st_ino != expected_inode:
        fail(label + " changed inode generation")
    if expected_mode != 0o700 or stat.S_IMODE(value.st_mode) != expected_mode:
        fail(label + " is not an exact private directory")
    if expected_uid != os.getuid() or value.st_uid != expected_uid:
        fail(label + " is not owned by the current user")
    return value


def require_authority_file_metadata(
    value,
    identity,
    label,
    *,
    exact_times=True,
    require_stage_mode=False,
):
    (
        expected_device,
        expected_inode,
        expected_mode,
        expected_nlink,
        expected_uid,
        expected_gid,
        expected_size,
        expected_mtime_ns,
        expected_ctime_ns,
        _expected_digest,
    ) = identity
    if not stat.S_ISREG(value.st_mode):
        fail(label + " is not a regular file")
    if value.st_dev != expected_device or value.st_ino != expected_inode:
        fail(label + " changed inode generation")
    allowed_modes = (0o600,) if require_stage_mode else (0o600, 0o640, 0o644)
    if expected_mode not in allowed_modes:
        fail(label + " expected mode is outside the authority allowlist")
    if stat.S_IMODE(value.st_mode) != expected_mode:
        fail(label + " changed exact mode")
    if expected_nlink != 1 or value.st_nlink != expected_nlink:
        fail(label + " does not have exactly one admitted link")
    if expected_uid != os.getuid() or value.st_uid != expected_uid:
        fail(label + " is not owned by the current user")
    if value.st_gid != expected_gid:
        fail(label + " changed exact gid")
    if expected_size > MAX_REPAIR_MOVE_BYTES or value.st_size != expected_size:
        fail(label + " changed exact bounded size")
    if value.st_mtime_ns != expected_mtime_ns:
        fail(label + " changed exact mtime")
    if exact_times:
        if value.st_ctime_ns != expected_ctime_ns:
            fail(label + " changed exact ctime")
    elif value.st_ctime_ns < expected_ctime_ns:
        fail(label + " ctime moved backwards")
    return value


def require_authority_descriptor(
    descriptor,
    identity,
    label,
    *,
    exact_times=True,
    require_stage_mode=False,
):
    try:
        before = os.fstat(descriptor)
    except OSError as error:
        fail(label + " descriptor cannot be inspected: " + error.strerror)
    require_authority_file_metadata(
        before,
        identity,
        label,
        exact_times=exact_times,
        require_stage_mode=require_stage_mode,
    )
    if descriptor_digest(descriptor, identity[6], label) != identity[9]:
        fail(label + " changed exact digest")
    try:
        after = os.fstat(descriptor)
    except OSError as error:
        fail(label + " descriptor cannot be re-inspected: " + error.strerror)
    require_authority_file_metadata(
        after,
        identity,
        label,
        exact_times=exact_times,
        require_stage_mode=require_stage_mode,
    )
    if authority_file_snapshot(after) != authority_file_snapshot(before):
        fail(label + " changed while hashing")
    return after


def require_named_authority_file(
    parent_descriptor,
    name,
    identity,
    label,
    *,
    exact_times=True,
    require_stage_mode=False,
):
    try:
        named_before = lstat_at(parent_descriptor, name)
    except OSError as error:
        fail(label + " cannot be inspected before open: " + error.strerror)
    require_authority_file_metadata(
        named_before,
        identity,
        label,
        exact_times=exact_times,
        require_stage_mode=require_stage_mode,
    )
    descriptor = None
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
            dir_fd=parent_descriptor,
        )
        opened = require_authority_descriptor(
            descriptor,
            identity,
            "opened " + label,
            exact_times=exact_times,
            require_stage_mode=require_stage_mode,
        )
        try:
            named_after = lstat_at(parent_descriptor, name)
        except OSError as error:
            fail(label + " cannot be inspected after open: " + error.strerror)
        require_authority_file_metadata(
            named_after,
            identity,
            label,
            exact_times=exact_times,
            require_stage_mode=require_stage_mode,
        )
        expected_snapshot = authority_file_snapshot(named_before)
        if authority_file_snapshot(opened) != expected_snapshot:
            fail(label + " opened a different generation")
        if authority_file_snapshot(named_after) != expected_snapshot:
            fail(label + " changed during admission")
        return named_after
    finally:
        if descriptor is not None:
            os.close(descriptor)


def require_authority_absent(parent_descriptor, name, label):
    require_absent(parent_descriptor, name, label)


def read_authority_stdin(expected_size, expected_digest, label):
    if expected_size > MAX_REPAIR_MOVE_BYTES:
        fail(label + " exceeds the authority stage size boundary")
    try:
        value = sys.stdin.buffer.read(expected_size + 1)
    except OSError as error:
        fail(label + " cannot be read from stdin: " + error.strerror)
    if len(value) != expected_size:
        fail(label + " changed exact size")
    if hashlib.sha256(value).hexdigest() != expected_digest:
        fail(label + " changed exact digest")
    return value


def write_authority_descriptor(
    descriptor,
    value,
    label,
    *,
    operation_name,
    source_name,
    destination_name,
):
    offset = 0
    while offset < len(value):
        try:
            written = os.pwrite(descriptor, value[offset : offset + 64 * 1024], offset)
        except OSError as error:
            fail(label + " write failed: " + error.strerror)
        if written <= 0:
            fail(label + " write made no progress")
        offset += written
        if offset < len(value):
            repair_move_test_pause(
                "after-authority-stage-partial-write",
                operation_name,
                source_name,
                destination_name,
            )


def authority_identity_receipt(result, prefix, identity):
    (
        device,
        inode,
        mode,
        nlink,
        uid,
        gid,
        size,
        mtime_ns,
        ctime_ns,
        digest,
    ) = identity
    result[prefix + "Device"] = str(device)
    result[prefix + "Inode"] = str(inode)
    result[prefix + "Mode"] = str(mode)
    result[prefix + "LinkCount"] = str(nlink)
    result[prefix + "Uid"] = str(uid)
    result[prefix + "Gid"] = str(gid)
    result[prefix + "Size"] = str(size)
    result[prefix + "MtimeNs"] = str(mtime_ns)
    result[prefix + "CtimeNs"] = str(ctime_ns)
    result[prefix + "Digest"] = digest


def authority_parent_receipt(result, prefix, identity):
    device, inode, mode, uid = identity
    result[prefix + "Device"] = str(device)
    result[prefix + "Inode"] = str(inode)
    result[prefix + "Mode"] = str(mode)
    result[prefix + "Uid"] = str(uid)


def write_authority_receipt(result):
    result["protocol"] = AUTHORITY_PROTOCOL
    sys.stdout.write(json.dumps(result, sort_keys=True, separators=(",", ":")))


def require_authority_exchange_before(
    source_name,
    destination_name,
    source_identity,
    destination_identity,
    source_parent_identity,
    destination_parent_identity,
    expected_snapshots=None,
):
    if source_identity[:2] == destination_identity[:2]:
        fail("authority exchange requires two distinct file generations")
    if (
        source_parent_identity[:2] == destination_parent_identity[:2]
        and source_name == destination_name
    ):
        fail("authority exchange requires two distinct entries")
    if (
        source_identity[0] != source_parent_identity[0]
        or destination_identity[0] != destination_parent_identity[0]
        or source_parent_identity[0] != destination_parent_identity[0]
    ):
        fail("authority exchange files and parents must share one device")
    source_parent = require_authority_parent(
        3, source_parent_identity, "authority exchange source parent"
    )
    destination_parent = require_authority_parent(
        4, destination_parent_identity, "authority exchange destination parent"
    )
    held_source = require_authority_descriptor(
        5, source_identity, "held authority exchange source"
    )
    held_destination = require_authority_descriptor(
        6, destination_identity, "held authority exchange destination"
    )
    named_source = require_named_authority_file(
        3, source_name, source_identity, "authority exchange source entry"
    )
    named_destination = require_named_authority_file(
        4,
        destination_name,
        destination_identity,
        "authority exchange destination entry",
    )
    if authority_file_snapshot(named_source) != authority_file_snapshot(held_source):
        fail("authority exchange source entry differs from its held generation")
    if authority_file_snapshot(named_destination) != authority_file_snapshot(
        held_destination
    ):
        fail("authority exchange destination entry differs from its held generation")
    snapshots = (
        directory_snapshot(source_parent),
        directory_snapshot(destination_parent),
        authority_file_snapshot(held_source),
        authority_file_snapshot(held_destination),
    )
    if expected_snapshots is not None and snapshots != expected_snapshots:
        fail("authority exchange topology changed during admission")
    return snapshots


def moved_authority_identity(descriptor, admitted_identity, label):
    moved = require_authority_descriptor(
        descriptor,
        admitted_identity,
        label,
        exact_times=False,
    )
    return authority_file_identity_from_value(moved, admitted_identity[9])


def require_authority_exchange_after(
    source_name,
    destination_name,
    source_identity,
    destination_identity,
    source_parent_identity,
    destination_parent_identity,
):
    require_authority_parent(
        3, source_parent_identity, "authority exchange source parent"
    )
    require_authority_parent(
        4, destination_parent_identity, "authority exchange destination parent"
    )
    moved_source_identity = moved_authority_identity(
        5, source_identity, "held exchanged authority source"
    )
    moved_destination_identity = moved_authority_identity(
        6, destination_identity, "held exchanged authority destination"
    )
    named_predecessor = require_named_authority_file(
        3,
        source_name,
        moved_destination_identity,
        "exchanged authority predecessor entry",
    )
    named_successor = require_named_authority_file(
        4,
        destination_name,
        moved_source_identity,
        "exchanged authority successor entry",
    )
    if authority_file_snapshot(named_predecessor) != authority_file_snapshot(
        os.fstat(6)
    ):
        fail("exchanged authority predecessor lost its held generation")
    if authority_file_snapshot(named_successor) != authority_file_snapshot(os.fstat(5)):
        fail("exchanged authority successor lost its held generation")
    return moved_source_identity, moved_destination_identity


def authority_exchange(arguments):
    if len(arguments) != 30:
        fail(
            "authority-exchange requires two names, two full file identities, and two parent identities"
        )
    source_name = entry_name(arguments[0], "authority exchange source name")
    destination_name = entry_name(
        arguments[1], "authority exchange destination name"
    )
    source_identity = parse_authority_file_identity(
        arguments, 2, "authority exchange source"
    )
    destination_identity = parse_authority_file_identity(
        arguments, 12, "authority exchange destination"
    )
    source_parent_identity = parse_authority_parent_identity(
        arguments, 22, "authority exchange source parent"
    )
    destination_parent_identity = parse_authority_parent_identity(
        arguments, 26, "authority exchange destination parent"
    )
    admitted_snapshots = require_authority_exchange_before(
        source_name,
        destination_name,
        source_identity,
        destination_identity,
        source_parent_identity,
        destination_parent_identity,
    )
    require_authority_exchange_before(
        source_name,
        destination_name,
        source_identity,
        destination_identity,
        source_parent_identity,
        destination_parent_identity,
        admitted_snapshots,
    )
    repair_move_test_pause(
        "after-authority-exchange-final-validation-before-syscall",
        "authority-exchange",
        source_name,
        destination_name,
    )
    native_rename_exchange(source_name, destination_name)
    repair_move_test_pause(
        "after-authority-exchange-syscall-before-sync",
        "authority-exchange",
        source_name,
        destination_name,
    )
    require_authority_exchange_after(
        source_name,
        destination_name,
        source_identity,
        destination_identity,
        source_parent_identity,
        destination_parent_identity,
    )
    fsync_repair_directory(4, "authority exchange destination parent")
    if source_parent_identity[:2] != destination_parent_identity[:2]:
        fsync_repair_directory(3, "authority exchange source parent")
    moved_source_identity, moved_destination_identity = require_authority_exchange_after(
        source_name,
        destination_name,
        source_identity,
        destination_identity,
        source_parent_identity,
        destination_parent_identity,
    )
    result = {
        "operation": "authority-exchange",
        "sourceName": source_name,
        "destinationName": destination_name,
    }
    authority_identity_receipt(result, "source", source_identity)
    authority_identity_receipt(result, "destination", destination_identity)
    authority_identity_receipt(result, "sourceAfter", moved_source_identity)
    authority_identity_receipt(
        result, "destinationAfter", moved_destination_identity
    )
    authority_parent_receipt(result, "sourceParent", source_parent_identity)
    authority_parent_receipt(
        result, "destinationParent", destination_parent_identity
    )
    write_authority_receipt(result)


def require_authority_retire_before(
    source_name,
    quarantine_name,
    source_identity,
    source_parent_identity,
    quarantine_parent_identity,
    expected_snapshots=None,
):
    if (
        source_parent_identity[:2] == quarantine_parent_identity[:2]
        and source_name == quarantine_name
    ):
        fail("authority retirement requires two distinct entries")
    if (
        source_identity[0] != source_parent_identity[0]
        or source_identity[0] != quarantine_parent_identity[0]
    ):
        fail("authority retirement file and parents must share one device")
    source_parent = require_authority_parent(
        3, source_parent_identity, "authority retirement source parent"
    )
    quarantine_parent = require_authority_parent(
        4, quarantine_parent_identity, "authority retirement quarantine parent"
    )
    held_source = require_authority_descriptor(
        5, source_identity, "held authority retirement source"
    )
    named_source = require_named_authority_file(
        3, source_name, source_identity, "authority retirement source entry"
    )
    if authority_file_snapshot(named_source) != authority_file_snapshot(held_source):
        fail("authority retirement source entry differs from its held generation")
    require_authority_absent(
        4, quarantine_name, "authority retirement quarantine destination"
    )
    snapshots = (
        directory_snapshot(source_parent),
        directory_snapshot(quarantine_parent),
        authority_file_snapshot(held_source),
    )
    if expected_snapshots is not None and snapshots != expected_snapshots:
        fail("authority retirement topology changed during admission")
    return snapshots


def require_authority_retire_after(
    source_name,
    quarantine_name,
    source_identity,
    source_parent_identity,
    quarantine_parent_identity,
):
    require_authority_parent(
        3, source_parent_identity, "authority retirement source parent"
    )
    require_authority_parent(
        4, quarantine_parent_identity, "authority retirement quarantine parent"
    )
    moved_source_identity = moved_authority_identity(
        5, source_identity, "held retired authority source"
    )
    try:
        lstat_at(3, source_name)
    except FileNotFoundError:
        pass
    except OSError as error:
        fail("retired authority source cannot be inspected: " + error.strerror)
    else:
        fail("retired authority source entry reappeared")
    named_quarantine = require_named_authority_file(
        4,
        quarantine_name,
        moved_source_identity,
        "retired authority quarantine entry",
    )
    if authority_file_snapshot(named_quarantine) != authority_file_snapshot(
        os.fstat(5)
    ):
        fail("retired authority quarantine lost its held generation")
    return moved_source_identity


def authority_retire(arguments):
    if len(arguments) != 20:
        fail(
            "authority-retire requires two names, one full file identity, and two parent identities"
        )
    source_name = entry_name(arguments[0], "authority retirement source name")
    quarantine_name = entry_name(
        arguments[1], "authority retirement quarantine name"
    )
    source_identity = parse_authority_file_identity(
        arguments, 2, "authority retirement source"
    )
    source_parent_identity = parse_authority_parent_identity(
        arguments, 12, "authority retirement source parent"
    )
    quarantine_parent_identity = parse_authority_parent_identity(
        arguments, 16, "authority retirement quarantine parent"
    )
    admitted_snapshots = require_authority_retire_before(
        source_name,
        quarantine_name,
        source_identity,
        source_parent_identity,
        quarantine_parent_identity,
    )
    require_authority_retire_before(
        source_name,
        quarantine_name,
        source_identity,
        source_parent_identity,
        quarantine_parent_identity,
        admitted_snapshots,
    )
    repair_move_test_pause(
        "after-authority-retire-final-validation-before-syscall",
        "authority-retire",
        source_name,
        quarantine_name,
    )
    native_rename_exclusive(source_name, quarantine_name)
    repair_move_test_pause(
        "after-authority-retire-syscall-before-sync",
        "authority-retire",
        source_name,
        quarantine_name,
    )
    require_authority_retire_after(
        source_name,
        quarantine_name,
        source_identity,
        source_parent_identity,
        quarantine_parent_identity,
    )
    fsync_repair_directory(4, "authority retirement quarantine parent")
    if source_parent_identity[:2] != quarantine_parent_identity[:2]:
        fsync_repair_directory(3, "authority retirement source parent")
    moved_source_identity = require_authority_retire_after(
        source_name,
        quarantine_name,
        source_identity,
        source_parent_identity,
        quarantine_parent_identity,
    )
    result = {
        "operation": "authority-retire",
        "sourceName": source_name,
        "quarantineName": quarantine_name,
    }
    authority_identity_receipt(result, "source", source_identity)
    authority_identity_receipt(result, "sourceAfter", moved_source_identity)
    authority_parent_receipt(result, "sourceParent", source_parent_identity)
    authority_parent_receipt(
        result, "quarantineParent", quarantine_parent_identity
    )
    write_authority_receipt(result)


def require_created_stage_descriptor(descriptor, mode, label):
    try:
        value = os.fstat(descriptor)
    except OSError as error:
        fail(label + " descriptor cannot be inspected: " + error.strerror)
    if not stat.S_ISREG(value.st_mode):
        fail(label + " is not a regular file")
    if mode != 0o600 or stat.S_IMODE(value.st_mode) != mode:
        fail(label + " is not an exact private stage")
    if value.st_uid != os.getuid():
        fail(label + " is not owned by the current user")
    if value.st_nlink != 1:
        fail(label + " does not have exactly one link")
    if value.st_size < 0 or value.st_size > MAX_REPAIR_MOVE_BYTES:
        fail(label + " exceeds the authority stage size boundary")
    return value


def require_authority_rewrite_descriptor_access(descriptor):
    try:
        flags = fcntl.fcntl(descriptor, fcntl.F_GETFL)
    except OSError as error:
        fail("authority rewrite descriptor flags cannot be inspected: " + error.strerror)
    if flags & os.O_ACCMODE != os.O_RDWR:
        fail("authority rewrite descriptor is not open read-write")
    if flags & os.O_APPEND:
        fail("authority rewrite descriptor must not use append mode")


def require_result_stage(
    parent_descriptor,
    name,
    held_descriptor,
    mode,
    expected_size,
    expected_digest,
    label,
):
    held = require_created_stage_descriptor(held_descriptor, mode, "held " + label)
    if held.st_size != expected_size:
        fail("held " + label + " changed exact size")
    if descriptor_digest(held_descriptor, expected_size, "held " + label) != expected_digest:
        fail("held " + label + " changed exact digest")
    try:
        held_after = os.fstat(held_descriptor)
    except OSError as error:
        fail("held " + label + " cannot be re-inspected: " + error.strerror)
    if authority_file_snapshot(held_after) != authority_file_snapshot(held):
        fail("held " + label + " changed while hashing")
    identity = authority_file_identity_from_value(held, expected_digest)
    named = require_named_authority_file(
        parent_descriptor,
        name,
        identity,
        label,
        require_stage_mode=True,
    )
    if authority_file_snapshot(named) != authority_file_snapshot(held):
        fail(label + " differs from its held stage generation")
    return identity


def authority_stage_create(arguments):
    if len(arguments) != 8:
        fail(
            "authority-stage-create requires one name, one proposed content identity, and one parent identity"
        )
    name = entry_name(arguments[0], "authority stage name")
    new_mode = integer(arguments[1], "authority stage mode")
    new_size = integer(arguments[2], "authority stage size")
    new_digest = sha256_digest(arguments[3], "authority stage digest")
    parent_identity = parse_authority_parent_identity(
        arguments, 4, "authority stage parent"
    )
    if new_mode != 0o600:
        fail("authority stage mode must be exactly 0600")
    value = read_authority_stdin(new_size, new_digest, "authority stage input")
    parent = require_authority_parent(3, parent_identity, "authority stage parent")
    require_authority_absent(3, name, "authority stage destination")
    admitted_parent_snapshot = directory_snapshot(parent)
    parent = require_authority_parent(3, parent_identity, "authority stage parent")
    require_directory_snapshot(
        parent, admitted_parent_snapshot, "authority stage parent"
    )
    require_authority_absent(3, name, "authority stage destination")
    repair_move_test_pause(
        "after-authority-stage-create-final-validation-before-syscall",
        "authority-stage-create",
        name,
        name,
    )
    descriptor = None
    old_umask = os.umask(0o077)
    try:
        try:
            descriptor = os.open(
                name,
                os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                new_mode,
                dir_fd=3,
            )
        except OSError as error:
            if error.errno == errno.EEXIST:
                fail("authority stage destination already exists", 17)
            fail("authority stage creation failed: " + error.strerror)
    finally:
        os.umask(old_umask)
    try:
        require_created_stage_descriptor(descriptor, new_mode, "created authority stage")
        repair_move_test_pause(
            "after-authority-stage-create-before-write",
            "authority-stage-create",
            name,
            name,
        )
        write_authority_descriptor(
            descriptor,
            value,
            "authority stage",
            operation_name="authority-stage-create",
            source_name=name,
            destination_name=name,
        )
        repair_move_test_pause(
            "after-authority-stage-create-write-before-file-sync",
            "authority-stage-create",
            name,
            name,
        )
        try:
            os.fsync(descriptor)
        except OSError as error:
            fail("authority stage file fsync failed: " + error.strerror)
        result_identity = require_result_stage(
            3,
            name,
            descriptor,
            new_mode,
            new_size,
            new_digest,
            "created authority stage entry",
        )
        fsync_repair_directory(3, "authority stage parent")
        result_identity = require_result_stage(
            3,
            name,
            descriptor,
            new_mode,
            new_size,
            new_digest,
            "created authority stage entry",
        )
    finally:
        if descriptor is not None:
            os.close(descriptor)
    result = {
        "operation": "authority-stage-create",
        "name": name,
        "requestedMode": str(new_mode),
        "requestedSize": str(new_size),
        "requestedDigest": new_digest,
    }
    authority_parent_receipt(result, "parent", parent_identity)
    authority_identity_receipt(result, "result", result_identity)
    write_authority_receipt(result)


def require_authority_stage_rewrite_before(
    old_name,
    new_name,
    old_identity,
    parent_identity,
    expected_snapshots=None,
):
    parent = require_authority_parent(3, parent_identity, "authority stage parent")
    held_stage = require_authority_descriptor(
        4,
        old_identity,
        "held authority rewrite stage",
    )
    named_stage = require_named_authority_file(
        3,
        old_name,
        old_identity,
        "authority rewrite stage entry",
    )
    if authority_file_snapshot(named_stage) != authority_file_snapshot(held_stage):
        fail("authority rewrite stage differs from its held generation")
    if old_name != new_name:
        require_authority_absent(3, new_name, "authority rewrite destination")
    snapshots = (
        directory_snapshot(parent),
        authority_file_snapshot(held_stage),
    )
    if expected_snapshots is not None and snapshots != expected_snapshots:
        fail("authority rewrite topology changed during admission")
    return snapshots


def require_moved_rewrite_stage(
    old_name,
    new_name,
    old_identity,
    parent_identity,
):
    require_authority_parent(3, parent_identity, "authority stage parent")
    moved_identity = moved_authority_identity(
        4, old_identity, "held moved authority rewrite stage"
    )
    try:
        lstat_at(3, old_name)
    except FileNotFoundError:
        pass
    except OSError as error:
        fail("authority rewrite source cannot be inspected: " + error.strerror)
    else:
        fail("authority rewrite source reappeared after exclusive rename")
    named_stage = require_named_authority_file(
        3,
        new_name,
        moved_identity,
        "moved authority rewrite stage entry",
    )
    if authority_file_snapshot(named_stage) != authority_file_snapshot(os.fstat(4)):
        fail("moved authority rewrite stage lost its held generation")
    return moved_identity


def authority_stage_rewrite(arguments):
    if len(arguments) != 19:
        fail(
            "authority-stage-rewrite requires two names, one full file identity, one proposed content identity, and one parent identity"
        )
    old_name = entry_name(arguments[0], "authority rewrite source name")
    new_name = entry_name(arguments[1], "authority rewrite destination name")
    old_identity = parse_authority_file_identity(
        arguments, 2, "authority rewrite source"
    )
    new_mode = integer(arguments[12], "authority rewrite mode")
    new_size = integer(arguments[13], "authority rewrite size")
    new_digest = sha256_digest(arguments[14], "authority rewrite digest")
    parent_identity = parse_authority_parent_identity(
        arguments, 15, "authority rewrite parent"
    )
    if new_mode != 0o600:
        fail("authority rewrite mode must be exactly 0600")
    value = read_authority_stdin(new_size, new_digest, "authority rewrite input")
    require_authority_rewrite_descriptor_access(4)
    admitted_snapshots = require_authority_stage_rewrite_before(
        old_name, new_name, old_identity, parent_identity
    )
    require_authority_stage_rewrite_before(
        old_name,
        new_name,
        old_identity,
        parent_identity,
        admitted_snapshots,
    )
    current_name = old_name
    current_identity = old_identity
    if old_name != new_name:
        repair_move_test_pause(
            "after-authority-stage-rewrite-rename-final-validation-before-syscall",
            "authority-stage-rewrite",
            old_name,
            new_name,
        )
        native_rename_exclusive_at(3, old_name, 3, new_name)
        current_identity = require_moved_rewrite_stage(
            old_name, new_name, old_identity, parent_identity
        )
        fsync_repair_directory(3, "authority rewrite parent after stage rename")
        current_name = new_name
    parent_before_write = require_authority_parent(
        3, parent_identity, "authority stage parent"
    )
    held_before_write = require_authority_descriptor(
        4,
        current_identity,
        "held authority rewrite stage before write",
    )
    named_before_write = require_named_authority_file(
        3,
        current_name,
        current_identity,
        "authority rewrite stage before write",
    )
    if authority_file_snapshot(named_before_write) != authority_file_snapshot(
        held_before_write
    ):
        fail("authority rewrite stage changed before write")
    write_snapshots = (
        directory_snapshot(parent_before_write),
        authority_file_snapshot(held_before_write),
    )
    parent_before_write = require_authority_parent(
        3, parent_identity, "authority stage parent"
    )
    held_before_write = require_authority_descriptor(
        4,
        current_identity,
        "held authority rewrite stage before write",
    )
    named_before_write = require_named_authority_file(
        3,
        current_name,
        current_identity,
        "authority rewrite stage before write",
    )
    if (
        directory_snapshot(parent_before_write),
        authority_file_snapshot(held_before_write),
    ) != write_snapshots or authority_file_snapshot(
        named_before_write
    ) != authority_file_snapshot(
        held_before_write
    ):
        fail("authority rewrite topology changed during final write admission")
    repair_move_test_pause(
        "after-authority-stage-rewrite-final-validation-before-chmod",
        "authority-stage-rewrite",
        current_name,
        new_name,
    )
    try:
        os.fchmod(4, new_mode)
    except OSError as error:
        fail("authority rewrite mode normalization failed: " + error.strerror)
    try:
        normalized_value = os.fstat(4)
    except OSError as error:
        fail(
            "normalized authority rewrite generation cannot be inspected: "
            + error.strerror
        )
    if (
        normalized_value.st_dev != current_identity[0]
        or normalized_value.st_ino != current_identity[1]
        or stat.S_IMODE(normalized_value.st_mode) != new_mode
        or normalized_value.st_nlink != current_identity[3]
        or normalized_value.st_uid != current_identity[4]
        or normalized_value.st_gid != current_identity[5]
        or normalized_value.st_size != current_identity[6]
        or normalized_value.st_mtime_ns != current_identity[7]
        or normalized_value.st_ctime_ns < current_identity[8]
    ):
        fail("authority rewrite generation changed during mode normalization")
    current_identity = authority_file_identity_from_value(
        normalized_value, current_identity[9]
    )
    parent_before_write = require_authority_parent(
        3, parent_identity, "authority stage parent"
    )
    held_before_write = require_authority_descriptor(
        4,
        current_identity,
        "normalized held authority rewrite stage",
        require_stage_mode=True,
    )
    named_before_write = require_named_authority_file(
        3,
        current_name,
        current_identity,
        "normalized authority rewrite stage",
        require_stage_mode=True,
    )
    if authority_file_snapshot(named_before_write) != authority_file_snapshot(
        held_before_write
    ):
        fail("normalized authority rewrite stage changed before final admission")
    normalized_snapshots = (
        directory_snapshot(parent_before_write),
        authority_file_snapshot(held_before_write),
    )
    parent_before_write = require_authority_parent(
        3, parent_identity, "authority stage parent"
    )
    held_before_write = require_authority_descriptor(
        4,
        current_identity,
        "normalized held authority rewrite stage",
        require_stage_mode=True,
    )
    named_before_write = require_named_authority_file(
        3,
        current_name,
        current_identity,
        "normalized authority rewrite stage",
        require_stage_mode=True,
    )
    if (
        directory_snapshot(parent_before_write),
        authority_file_snapshot(held_before_write),
    ) != normalized_snapshots or authority_file_snapshot(
        named_before_write
    ) != authority_file_snapshot(
        held_before_write
    ):
        fail("normalized authority rewrite topology changed during final admission")
    repair_move_test_pause(
        "after-authority-stage-rewrite-final-validation-before-truncate",
        "authority-stage-rewrite",
        current_name,
        new_name,
    )
    try:
        os.ftruncate(4, 0)
    except OSError as error:
        fail("authority rewrite truncate failed: " + error.strerror)
    repair_move_test_pause(
        "after-authority-stage-rewrite-truncate-before-write",
        "authority-stage-rewrite",
        current_name,
        new_name,
    )
    write_authority_descriptor(
        4,
        value,
        "authority rewrite stage",
        operation_name="authority-stage-rewrite",
        source_name=current_name,
        destination_name=new_name,
    )
    repair_move_test_pause(
        "after-authority-stage-rewrite-write-before-file-sync",
        "authority-stage-rewrite",
        current_name,
        new_name,
    )
    try:
        os.fsync(4)
    except OSError as error:
        fail("authority rewrite stage fsync failed: " + error.strerror)
    result_identity = require_result_stage(
        3,
        current_name,
        4,
        new_mode,
        new_size,
        new_digest,
        "rewritten authority stage entry",
    )
    fsync_repair_directory(3, "authority rewrite parent")
    result_identity = require_result_stage(
        3,
        current_name,
        4,
        new_mode,
        new_size,
        new_digest,
        "rewritten authority stage entry",
    )
    result = {
        "operation": "authority-stage-rewrite",
        "oldName": old_name,
        "newName": new_name,
        "requestedMode": str(new_mode),
        "requestedSize": str(new_size),
        "requestedDigest": new_digest,
    }
    authority_identity_receipt(result, "old", old_identity)
    authority_parent_receipt(result, "parent", parent_identity)
    authority_identity_receipt(result, "result", result_identity)
    write_authority_receipt(result)


def authority_inventory_name(value):
    value = entry_name(value, "authority inventory entry")
    try:
        encoded = value.encode("utf-8", "strict")
    except UnicodeEncodeError:
        fail("authority inventory entry name is not valid UTF-8")
    if encoded.decode("utf-8", "strict") != value:
        fail("authority inventory entry name is not canonical UTF-8")
    return value, encoded


def require_authority_inventory_file(value, max_file_bytes, label):
    provisional_identity = authority_file_identity_from_value(value, "0" * 64)
    require_authority_file_metadata(value, provisional_identity, label)
    if value.st_size > max_file_bytes:
        fail(label + " exceeds the requested per-file boundary")
    return value


def read_authority_inventory_entry(name, max_file_bytes):
    try:
        named = lstat_at(3, name)
    except OSError as error:
        fail("authority inventory entry cannot be inspected: " + error.strerror)
    require_authority_inventory_file(
        named, max_file_bytes, "authority inventory entry"
    )
    repair_move_test_pause(
        "after-authority-retirement-inventory-entry-metadata",
        "authority-retirement-inventory",
        name,
        "",
    )
    return authority_file_snapshot(named)


def authority_inventory_entry_receipt(name, identity):
    return {
        "name": name,
        "device": str(identity[0]),
        "inode": str(identity[1]),
        "mode": str(identity[2]),
        "linkCount": str(identity[3]),
        "uid": str(identity[4]),
        "gid": str(identity[5]),
        "size": str(identity[6]),
        "mtimeNs": str(identity[7]),
        "ctimeNs": str(identity[8]),
    }


def parse_authority_inventory_modes(value):
    allowed_values = {
        str(0o600): 0o600,
        str(0o640): 0o640,
        str(0o644): 0o644,
    }
    pieces = value.split(",")
    if not pieces or any(piece not in allowed_values for piece in pieces):
        fail("authority entry inventory allowed modes are invalid")
    modes = tuple(allowed_values[piece] for piece in pieces)
    canonical = tuple(mode for mode in (0o600, 0o640, 0o644) if mode in modes)
    if modes != canonical:
        fail("authority entry inventory allowed modes are not canonical")
    return modes


def require_authority_entry_inventory_file(
    value,
    allowed_modes,
    allow_empty,
    max_file_bytes,
    label,
):
    require_authority_inventory_file(value, max_file_bytes, label)
    if stat.S_IMODE(value.st_mode) not in allowed_modes:
        fail(label + " mode is outside the requested allowlist")
    if not allow_empty and value.st_size == 0:
        fail(label + " is empty")
    return value


def authority_inventory_parent_fields(result, parent_identity, parent_value):
    result["parentDevice"] = str(parent_identity[0])
    result["parentInode"] = str(parent_identity[1])
    result["parentMode"] = str(parent_identity[2])
    result["parentUid"] = str(parent_identity[3])
    result["parentGid"] = str(parent_value.st_gid)
    result["parentLinkCount"] = str(parent_value.st_nlink)
    result["parentSize"] = str(parent_value.st_size)
    result["parentMtimeNs"] = str(parent_value.st_mtime_ns)
    result["parentCtimeNs"] = str(parent_value.st_ctime_ns)


def authority_inventory_entry_missing(name):
    try:
        lstat_at(3, name)
    except FileNotFoundError:
        return True
    except OSError as error:
        fail("authority entry inventory target cannot be inspected: " + error.strerror)
    return False


def authority_entry_inventory(arguments):
    if len(arguments) != 9:
        fail(
            "authority-entry-inventory requires one name, mode, missing and empty policies, one file bound, and one parent identity"
        )
    name, _encoded_name = authority_inventory_name(arguments[0])
    allowed_modes = parse_authority_inventory_modes(arguments[1])
    if arguments[2] not in ("0", "1"):
        fail("authority entry inventory allow-missing policy must be 0 or 1")
    allow_missing = arguments[2] == "1"
    if arguments[3] not in ("0", "1"):
        fail("authority entry inventory allow-empty policy must be 0 or 1")
    allow_empty = arguments[3] == "1"
    max_file_bytes = integer(
        arguments[4], "authority entry inventory per-file byte limit"
    )
    parent_identity = parse_authority_parent_identity(
        arguments, 5, "authority entry inventory parent"
    )
    if max_file_bytes > MAX_REPAIR_MOVE_BYTES:
        fail("authority entry inventory per-file limit exceeds the compiled boundary")
    parent_before = require_authority_parent(
        3, parent_identity, "authority entry inventory parent"
    )
    admitted_parent_snapshot = directory_snapshot(parent_before)
    if authority_inventory_entry_missing(name):
        if not allow_missing:
            fail("authority entry inventory target is missing")
        repair_move_test_pause(
            "after-authority-entry-inventory-first-missing-proof",
            "authority-entry-inventory",
            name,
            "",
        )
        if not authority_inventory_entry_missing(name):
            fail("authority entry inventory target appeared during missing proof")
        parent_after = require_authority_parent(
            3, parent_identity, "authority entry inventory parent"
        )
        require_directory_snapshot(
            parent_after,
            admitted_parent_snapshot,
            "authority entry inventory parent",
        )
        result = {
            "operation": "authority-entry-inventory",
            "name": name,
            "missing": True,
            "requestedAllowedModes": arguments[1],
            "requestedAllowMissing": allow_missing,
            "requestedAllowEmpty": allow_empty,
            "requestedMaxFileBytes": str(max_file_bytes),
        }
        authority_inventory_parent_fields(result, parent_identity, parent_before)
        write_authority_receipt(result)
        return
    try:
        named_before = lstat_at(3, name)
    except OSError as error:
        fail("authority entry inventory target cannot be inspected: " + error.strerror)
    require_authority_entry_inventory_file(
        named_before,
        allowed_modes,
        allow_empty,
        max_file_bytes,
        "authority entry inventory target",
    )
    repair_move_test_pause(
        "after-authority-entry-inventory-lstat-before-open",
        "authority-entry-inventory",
        name,
        "",
    )
    descriptor = None
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
            dir_fd=3,
        )
        opened_before = require_authority_entry_inventory_file(
            os.fstat(descriptor),
            allowed_modes,
            allow_empty,
            max_file_bytes,
            "opened authority entry inventory target",
        )
        if authority_file_snapshot(opened_before) != authority_file_snapshot(
            named_before
        ):
            fail("authority entry inventory opened a different generation")
        digest = descriptor_digest(
            descriptor,
            opened_before.st_size,
            "authority entry inventory target",
        )
        repair_move_test_pause(
            "after-authority-entry-inventory-hash-before-revalidation",
            "authority-entry-inventory",
            name,
            "",
        )
        opened_after = require_authority_entry_inventory_file(
            os.fstat(descriptor),
            allowed_modes,
            allow_empty,
            max_file_bytes,
            "opened authority entry inventory target",
        )
        if authority_file_snapshot(opened_after) != authority_file_snapshot(
            opened_before
        ):
            fail("authority entry inventory target changed while hashing")
        try:
            named_after = lstat_at(3, name)
        except OSError as error:
            fail(
                "authority entry inventory target cannot be re-inspected: "
                + error.strerror
            )
        require_authority_entry_inventory_file(
            named_after,
            allowed_modes,
            allow_empty,
            max_file_bytes,
            "authority entry inventory target",
        )
        if authority_file_snapshot(named_after) != authority_file_snapshot(
            opened_before
        ):
            fail("authority entry inventory target changed during admission")
        parent_after = require_authority_parent(
            3, parent_identity, "authority entry inventory parent"
        )
        require_directory_snapshot(
            parent_after,
            admitted_parent_snapshot,
            "authority entry inventory parent",
        )
        identity = authority_file_identity_from_value(opened_before, digest)
    finally:
        if descriptor is not None:
            os.close(descriptor)
    result = {
        "operation": "authority-entry-inventory",
        "name": name,
        "missing": False,
        "requestedAllowedModes": arguments[1],
        "requestedAllowMissing": allow_missing,
        "requestedAllowEmpty": allow_empty,
        "requestedMaxFileBytes": str(max_file_bytes),
    }
    authority_inventory_parent_fields(result, parent_identity, parent_before)
    authority_identity_receipt(result, "entry", identity)
    write_authority_receipt(result)


def encode_authority_inventory_receipt(result):
    result["encodedOutputBytes"] = "0"
    for _attempt in range(8):
        encoded = json.dumps(
            result,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        encoded_size = str(len(encoded))
        if result["encodedOutputBytes"] == encoded_size:
            return encoded
        result["encodedOutputBytes"] = encoded_size
    fail("authority inventory encoded receipt size did not converge")


def authority_retirement_inventory(arguments):
    if len(arguments) != 8:
        fail(
            "authority-retirement-inventory requires four bounds and one parent identity"
        )
    max_entries = integer(arguments[0], "authority inventory entry limit")
    max_encoded_bytes = integer(
        arguments[1], "authority inventory encoded output limit"
    )
    max_file_bytes = integer(
        arguments[2], "authority inventory per-file byte limit"
    )
    max_total_bytes = integer(
        arguments[3], "authority inventory total byte limit"
    )
    parent_identity = parse_authority_parent_identity(
        arguments, 4, "authority inventory parent"
    )
    if max_entries > MAX_AUTHORITY_INVENTORY_ENTRIES:
        fail("authority inventory entry limit exceeds the compiled boundary")
    if max_encoded_bytes > MAX_AUTHORITY_INVENTORY_ENCODED_BYTES:
        fail("authority inventory encoded output limit exceeds the compiled boundary")
    if max_file_bytes > MAX_REPAIR_MOVE_BYTES:
        fail("authority inventory per-file byte limit exceeds the compiled boundary")
    if max_total_bytes > MAX_AUTHORITY_INVENTORY_TOTAL_BYTES:
        fail("authority inventory total byte limit exceeds the compiled boundary")
    parent_before = require_authority_parent(
        3, parent_identity, "authority inventory parent"
    )
    admitted_parent_snapshot = directory_snapshot(parent_before)
    entries = []
    names = []
    encoded_name_bytes = 0
    total_bytes = 0
    try:
        with os.scandir(3) as iterator:
            for candidate in iterator:
                if len(names) >= max_entries:
                    fail("authority inventory exceeds the requested entry boundary")
                name, encoded_name = authority_inventory_name(candidate.name)
                encoded_name_bytes += len(encoded_name)
                if encoded_name_bytes > max_encoded_bytes:
                    fail("authority inventory names exceed the encoded output boundary")
                identity = read_authority_inventory_entry(name, max_file_bytes)
                total_bytes += identity[6]
                if total_bytes > max_total_bytes:
                    fail("authority inventory exceeds the requested total byte boundary")
                names.append((encoded_name, name))
                entries.append((encoded_name, name, identity))
    except OSError as error:
        fail("authority inventory directory scan failed: " + error.strerror)
    repair_move_test_pause(
        "after-authority-retirement-inventory-scan-before-directory-revalidation",
        "authority-retirement-inventory",
        "",
        "",
    )
    final_names = []
    try:
        with os.scandir(3) as iterator:
            for candidate in iterator:
                if len(final_names) >= max_entries:
                    fail("authority inventory exceeds the requested entry boundary")
                name, encoded_name = authority_inventory_name(candidate.name)
                final_names.append((encoded_name, name))
    except OSError as error:
        fail("authority inventory directory rescan failed: " + error.strerror)
    names.sort(key=lambda value: value[0])
    final_names.sort(key=lambda value: value[0])
    if names != final_names:
        fail("authority inventory names changed during admission")
    entries.sort(key=lambda value: value[0])
    for _encoded_name, name, identity in entries:
        try:
            final_value = lstat_at(3, name)
        except OSError as error:
            fail(
                "authority inventory entry cannot be finally inspected: "
                + error.strerror
            )
        require_authority_file_metadata(
            final_value,
            identity + ("0" * 64,),
            "authority inventory final entry",
        )
    parent_after = require_authority_parent(
        3, parent_identity, "authority inventory parent"
    )
    require_directory_snapshot(
        parent_after, admitted_parent_snapshot, "authority inventory parent"
    )
    result = {
        "protocol": AUTHORITY_PROTOCOL,
        "operation": "authority-retirement-inventory",
        "requestedMaxEntries": str(max_entries),
        "requestedMaxEncodedOutputBytes": str(max_encoded_bytes),
        "requestedMaxFileBytes": str(max_file_bytes),
        "requestedMaxTotalBytes": str(max_total_bytes),
        "parentDevice": str(parent_identity[0]),
        "parentInode": str(parent_identity[1]),
        "parentMode": str(parent_identity[2]),
        "parentUid": str(parent_identity[3]),
        "parentGid": str(parent_before.st_gid),
        "parentLinkCount": str(parent_before.st_nlink),
        "parentSize": str(parent_before.st_size),
        "parentMtimeNs": str(parent_before.st_mtime_ns),
        "parentCtimeNs": str(parent_before.st_ctime_ns),
        "entryCount": str(len(entries)),
        "totalBytes": str(total_bytes),
        "entries": [
            authority_inventory_entry_receipt(name, identity)
            for _encoded_name, name, identity in entries
        ],
    }
    encoded = encode_authority_inventory_receipt(result)
    if len(encoded) > max_encoded_bytes:
        fail("authority inventory exceeds the requested encoded output boundary")
    sys.stdout.buffer.write(encoded)


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


def list_directory_bounded(arguments):
    if len(arguments) != 4:
        fail("list-bounded requires two limits and one directory generation")
    max_entries = integer(arguments[0], "list entry limit")
    max_encoded_bytes = integer(arguments[1], "list encoded byte limit")
    expected_device = integer(arguments[2], "directory device")
    expected_inode = integer(arguments[3], "directory inode")
    if max_entries > MAX_BOUNDED_LIST_ENTRIES:
        fail("list entry limit exceeds the compiled boundary")
    if max_encoded_bytes > MAX_BOUNDED_LIST_ENCODED_BYTES:
        fail("list encoded byte limit exceeds the compiled boundary")
    admitted = require_directory(
        3, expected_device, expected_inode, "bounded list directory"
    )
    admitted_snapshot = directory_snapshot(admitted)
    entries = []
    encoded_size = 0
    try:
        with os.scandir(3) as iterator:
            for candidate in iterator:
                value = entry_name(candidate.name, "listed entry")
                encoded = os.fsencode(value)
                projected_size = encoded_size + len(encoded) + (1 if entries else 0)
                if len(entries) >= max_entries:
                    fail("directory listing exceeds the entry boundary")
                if projected_size > max_encoded_bytes:
                    fail("directory listing exceeds the encoded byte boundary")
                entries.append(encoded)
                encoded_size = projected_size
    except OSError as error:
        fail("bounded directory listing failed: " + error.strerror)
    repair_move_test_pause(
        "after-list-bounded-scan",
        "list-bounded",
        str(expected_inode),
        "",
    )
    revalidated = require_directory(
        3, expected_device, expected_inode, "bounded list directory"
    )
    require_directory_snapshot(
        revalidated, admitted_snapshot, "bounded list directory"
    )
    entries.sort()
    sys.stdout.buffer.write(b"\x00".join(entries))


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
        "authority-entry-inventory": authority_entry_inventory,
        "authority-exchange": authority_exchange,
        "authority-retire": authority_retire,
        "authority-retirement-inventory": authority_retirement_inventory,
        "authority-stage-create": authority_stage_create,
        "authority-stage-rewrite": authority_stage_rewrite,
        "directory-child-proof": directory_child_proof,
        "filesystem": filesystem_capacity,
        "list": list_directory,
        "list-bounded": list_directory_bounded,
        "mkdir": ensure_directory,
        "missing": require_missing,
        "probe": probe,
        "private-file-batch-read": private_file_batch_read,
        "private-file-batch-read-allow-empty": private_file_batch_read_allow_empty,
        "private-lease-state-batch-read": private_lease_state_batch_read,
        "read": read_generation,
        "remove-durable": remove_generation_durable,
        "rename": rename_generation,
        "rename-durable": rename_generation_durable,
        "replace-durable": replace_generation_durable,
        "exchange-durable": exchange_generations_durable,
        "retire-directory-durable": retire_directory_durable,
        "snapshot-tree": snapshot_tree,
        "sync": sync_directory,
    }
    operation = operations.get(sys.argv[1])
    if operation is None:
        fail("unsupported operation")
    operation(sys.argv[2:])


if __name__ == "__main__":
    main()
