"""Bind preview cleanup to process generations, never a bare PID or killpg."""

import ctypes
import errno
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


class BsdInfo(ctypes.Structure):
    # PROC_PIDTBSDINFO from Apple's bsd/sys/proc_info.h. Start time has
    # microsecond precision; ps lstart only has seconds and is not sufficient.
    _fields_ = [
        (name, ctypes.c_uint32) for name in (
            "flags", "status", "xstatus", "pid", "ppid", "uid", "gid",
            "ruid", "rgid", "svuid", "svgid", "reserved",
        )
    ] + [("comm", ctypes.c_char * 16), ("name", ctypes.c_char * 32)] + [
        (name, ctypes.c_uint32) for name in (
            "nfiles", "pgid", "jobc", "tdev", "tpgid", "nice",
        )
    ] + [("start_sec", ctypes.c_uint64), ("start_usec", ctypes.c_uint64)]


class UniqueInfo(ctypes.Structure):
    # Stable 56-byte ABI from Apple's proc_info_private.h. The reserved words
    # are not used; only the version accompanying this BSD snapshot is needed.
    _fields_ = [
        ("uuid", ctypes.c_uint8 * 16), ("uniqueid", ctypes.c_uint64),
        ("parent_uniqueid", ctypes.c_uint64), ("pidversion", ctypes.c_int32),
        ("reserved", ctypes.c_uint32), ("reserved2", ctypes.c_uint64),
        ("reserved3", ctypes.c_uint64),
    ]


class BsdWithUniqueInfo(ctypes.Structure):
    _fields_ = [("bsd", BsdInfo), ("unique", UniqueInfo)]


class AuditToken(ctypes.Structure):
    _fields_ = [("val", ctypes.c_uint32 * 8)]


def darwin_libproc():
    libproc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
    libproc.proc_pidinfo.argtypes = [
        ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int,
    ]
    libproc.proc_pidinfo.restype = ctypes.c_int
    try:
        bound_signal = libproc.proc_signal_with_audittoken
    except AttributeError as error:
        raise RuntimeError("macOS generation-bound signaling is unavailable; retaining preview") from error
    bound_signal.argtypes = [ctypes.POINTER(AuditToken), ctypes.c_int]
    bound_signal.restype = ctypes.c_int
    return libproc


def inspect(pid):
    if pid <= 1:
        raise ValueError("refusing a non-process PID")
    try:
        if sys.platform == "linux":
            stat = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
            boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
            return {
                "pid": pid, "session": int(stat[3]), "group": int(stat[2]),
                "birth": f"{boot}:{stat[19]}", "zombie": stat[0] == "Z",
            }
        if sys.platform == "darwin":
            libproc = darwin_libproc()
            snapshot = BsdWithUniqueInfo()
            # One kernel-held process reference supplies birth AND pidversion.
            # Separate reads could combine the old birth with a reused PID's token.
            ctypes.set_errno(0)
            size = libproc.proc_pidinfo(pid, 18, 0, ctypes.byref(snapshot), ctypes.sizeof(snapshot))
            if size != ctypes.sizeof(snapshot):
                if ctypes.get_errno() == errno.ESRCH:
                    return None
                raise RuntimeError(f"cannot read combined process generation for {pid}")
            info = snapshot.bsd
            return {
                "pid": pid, "session": os.getsid(pid), "group": info.pgid,
                "birth": f"{info.start_sec}:{info.start_usec}", "zombie": info.status == 5,
                "pidversion": snapshot.unique.pidversion,
            }
        raise RuntimeError(f"unsupported preview process platform: {sys.platform}")
    except (FileNotFoundError, ProcessLookupError):
        return None


def same_process(expected, current):
    return current is not None and all(
        expected.get(key) == current.get(key) for key in ("pid", "birth", "session", "group", "pidversion")
    )


def active(expected):
    current = inspect(expected["pid"])
    return same_process(expected, current) and not current["zombie"]


def session_members(session):
    pids = subprocess.check_output(["ps", "-axo", "pid="], text=True).split()
    members = []
    for value in pids:
        pid = int(value)
        if pid <= 1:
            continue
        try:
            if os.getsid(pid) != session:
                continue
        except ProcessLookupError:
            continue
        info = inspect(pid)
        if info and info["session"] == session and not info["zombie"]:
            members.append(info)
    return members


def send(expected, sig):
    """Recheck every signal, including escalation. Linux pins the generation."""
    pid = expected["pid"]
    fd = None
    try:
        if sys.platform == "linux":
            # No numeric-PID fallback if the kernel cannot pin the recipient.
            fd = os.pidfd_open(pid)
        if not active(expected):
            return
        if fd is not None:
            signal.pidfd_send_signal(fd, sig)
        elif sys.platform == "darwin":
            # This exported libproc SPI validates PID+version in the kernel and
            # holds the process reference through psignal. Never fall back to
            # kill(pid): a userspace birth check cannot close that reuse race.
            # XNU: libsyscall/wrappers/libproc/libproc.c, bsd/kern/proc_info.c.
            version = expected.get("pidversion")
            if not isinstance(version, int):
                raise RuntimeError("missing macOS PID version; retaining preview")
            token = AuditToken()
            token.val[5] = pid
            token.val[7] = version & 0xffffffff
            result = darwin_libproc().proc_signal_with_audittoken(ctypes.byref(token), sig)
            if result not in (0, errno.ESRCH):
                raise OSError(result, "generation-bound preview signal failed")
        else:
            raise RuntimeError("generation-bound preview signaling is unavailable")
    except ProcessLookupError:
        return
    finally:
        if fd is not None:
            os.close(fd)


def capture(pid):
    info = inspect(pid)
    if not info or info["zombie"] or info["session"] != pid or info["group"] != pid:
        raise RuntimeError("preview must be a live dedicated session and group leader")
    return info


def stop(expected, grace=2.0):
    pid = expected["pid"]
    if pid <= 1 or expected.get("session") != pid or expected.get("group") != pid:
        raise RuntimeError("preview ownership is not a dedicated session")
    current = inspect(pid)
    if not same_process(expected, current):
        raise RuntimeError("preview launcher identity changed or disappeared; retaining record")
    members = session_members(pid)
    # Validate the anchor again after enumeration, before any signals.
    if not same_process(expected, inspect(pid)):
        raise RuntimeError("preview launcher changed during enumeration; retaining record")
    # Children first. Captured generations remain valid after reparenting.
    members.sort(key=lambda info: info["pid"] == pid)
    for info in members:
        send(info, signal.SIGTERM)
    deadline = time.monotonic() + grace
    while any(active(info) for info in members) and time.monotonic() < deadline:
        time.sleep(0.02)
    for info in members:
        send(info, signal.SIGKILL)
    deadline = time.monotonic() + grace
    while any(active(info) for info in members) and time.monotonic() < deadline:
        time.sleep(0.02)
    # A shutdown handler could fork after the snapshot. Never remove the
    # worktree or claim success if any session member is still running.
    if any(active(info) for info in members) or session_members(pid):
        raise RuntimeError("preview session still has live processes; retaining record")


def check_signaling():
    if sys.platform == "darwin":
        if inspect(os.getpid()) is None:
            raise RuntimeError("cannot verify macOS process identity support")
    elif sys.platform == "linux":
        if not hasattr(signal, "pidfd_send_signal"):
            raise RuntimeError("Python pidfd signaling is unavailable")
        fd = os.pidfd_open(os.getpid())
        os.close(fd)
    else:
        raise RuntimeError("generation-bound preview signaling is unavailable")


def main():
    action = sys.argv[1]
    if action == "check":
        check_signaling()
    elif action == "capture":
        print(json.dumps(capture(int(sys.argv[2])), separators=(",", ":")))
    elif action == "stop":
        expected = json.loads(sys.argv[2])
        if expected.get("pid") != int(sys.argv[3]):
            raise RuntimeError("preview manifest PID does not match its process identity")
        stop(expected)
    else:
        raise ValueError("unknown preview process operation")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError, KeyError, AttributeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)
