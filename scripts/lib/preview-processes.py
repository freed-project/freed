"""Bind preview cleanup to process generations, never a bare PID or killpg."""

import ctypes
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
            libproc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
            libproc.proc_pidinfo.argtypes = [
                ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int,
            ]
            libproc.proc_pidinfo.restype = ctypes.c_int
            info = BsdInfo()
            size = libproc.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
            if size != ctypes.sizeof(info):
                if ctypes.get_errno() == 3:  # ESRCH
                    return None
                raise RuntimeError(f"cannot read process generation for {pid}")
            return {
                "pid": pid, "session": os.getsid(pid), "group": info.pgid,
                "birth": f"{info.start_sec}:{info.start_usec}", "zombie": info.status == 5,
            }
        raise RuntimeError(f"unsupported preview process platform: {sys.platform}")
    except (FileNotFoundError, ProcessLookupError):
        return None


def same_process(expected, current):
    return current is not None and all(
        expected.get(key) == current.get(key) for key in ("pid", "birth", "session", "group")
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
        else:
            os.kill(pid, sig)
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


def main():
    action = sys.argv[1]
    if action == "capture":
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
