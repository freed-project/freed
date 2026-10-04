"""Test-only subprocess supervision. Never signal a bare, unverified PID.

Linux adoption and Darwin private responsibility retain ownership when a
descendant double-forks or outlives its parent. Signals bind to captured process
generations. No production lifecycle imports or killpg.
"""

import ctypes
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time

DARWIN_CUSTODY = None


def process_snapshot(pid):
    """Read-only generation evidence for native fixture assertions."""
    if sys.platform == "darwin":
        from nightly_fixture_darwin import DarwinCustody
        return DarwinCustody(observe_only=True).inspect(pid)
    info = identity(pid)
    if not info:
        return None
    fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
    return {"pid": pid, "parentPid": info[1], "startTicks": info[2],
            "birth": Path("/proc/sys/kernel/random/boot_id").read_text().strip() + ":" + info[2],
            "zombie": fields[0] == "Z"}


def confine():
    global DARWIN_CUSTODY
    if sys.platform == "darwin":
        from nightly_fixture_darwin import DarwinCustody, ensure_private_responsibility
        ensure_private_responsibility()
        DARWIN_CUSTODY = DarwinCustody()
        return
    if sys.platform != "linux":
        raise RuntimeError("nightly fixture confinement requires Linux or macOS; refusing launch")
    if not hasattr(signal, "pidfd_send_signal"):
        raise RuntimeError("pidfd signaling unavailable; refusing launch")
    fd = os.pidfd_open(os.getpid())
    os.close(fd)
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        raise OSError(ctypes.get_errno(), "cannot establish test subreaper")


def identity(pid):
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        return (pid, int(fields[1]), fields[19])  # PID, parent, start ticks
    except (FileNotFoundError, ProcessLookupError):
        return None


def children():
    return [int(pid) for pid in Path(f"/proc/self/task/{os.getpid()}/children").read_text().split()]


def kill_owned(expected):
    # The parent is this still-live process, never a persisted numeric parent.
    if expected is None or expected[1] != os.getpid():
        raise RuntimeError("refusing a process not adopted by this supervisor")
    fd = None
    try:
        fd = os.pidfd_open(expected[0])
        if identity(expected[0]) != expected:
            raise RuntimeError("child generation changed; refusing signal")
        signal.pidfd_send_signal(fd, signal.SIGKILL)
    except ProcessLookupError:
        pass
    finally:
        if fd is not None:
            os.close(fd)


def reap(child):
    reaped = []
    while True:
        try:
            pid, status = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            break
        if pid == 0:
            break
        reaped.append(pid)
        if pid == child.pid:
            child.returncode = os.waitstatus_to_exitcode(status)
    return reaped


def cleanup(child):
    if DARWIN_CUSTODY is not None:
        return DARWIN_CUSTODY.cleanup(child, reap)
    deadline = time.monotonic() + 5
    killed = {}
    reaped = []
    while True:
        reaped.extend(reap(child))
        owned = children()
        if not owned:
            return {"signaled": list(killed.values()), "reaped": reaped, "remaining": []}
        if time.monotonic() >= deadline:
            raise RuntimeError(f"cleanup deadline exceeded; retained fixture; owned children={owned}")
        for pid in owned:
            expected = identity(pid)
            if expected is not None:
                kill_owned(expected)
                killed[pid] = {"pid": pid, "parentPid": expected[1], "startTicks": expected[2]}
        time.sleep(0.01)


def supervise(command, operation_ms, test_ms, shard_ms):
    confine()  # Fail before creating fixtures or launching any child.
    root = Path(tempfile.mkdtemp(prefix="freed-nightly-supervised-"))
    root_identity = root.stat()
    events = root / "events"
    temporary = root / "tmp"
    events.mkdir()
    temporary.mkdir()
    environment = dict(os.environ, FREED_NIGHTLY_SUPERVISION=str(events),
                       TMPDIR=str(temporary), TMP=str(temporary), TEMP=str(temporary))
    child = None
    cleaned = False
    reason = None
    receipt = None
    started = time.monotonic()
    observed = {}
    last_record = None
    interrupted = []
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda number, frame: interrupted.append(number))
    print(f"[nightly supervisor] fixture={root}", file=sys.stderr, flush=True)
    if DARWIN_CUSTODY is not None:
        print(f"[nightly supervisor] Darwin responsibility anchor={json.dumps(DARWIN_CUSTODY.anchor)}",
              file=sys.stderr, flush=True)
    try:
        child = subprocess.Popen(command, env=environment)
        while True:
            adopted = [pid for pid in reap(child) if pid != child.pid]
            if DARWIN_CUSTODY is None:
                extra = [pid for pid in children() if pid != child.pid]
            else:
                members = DARWIN_CUSTODY.inventory()
                parents = {os.getpid(), *(entry["pid"] for entry in members)}
                extra = [entry["pid"] for entry in members if entry["parentPid"] not in parents]
            if adopted or extra:
                reason = f"orphaned fixture descendants: {adopted + extra}"
                break
            if child.returncode is not None:
                break
            now = time.monotonic()
            if interrupted or (now - started) * 1000 >= shard_ms:
                reason = "interrupted" if interrupted else "independent shard deadline"
                break
            current = set()
            for entry in events.glob("*.json"):
                try:
                    record = json.loads(entry.read_text())
                except FileNotFoundError:
                    continue
                current.add(entry.name)
                if record["kind"] == "operation" or last_record is None:
                    last_record = record
                since = observed.setdefault(entry.name, now)
                budget = test_ms if record["kind"] == "test" else operation_ms
                if (now - since) * 1000 >= budget:
                    reason = (f"{record['kind']} deadline {budget}ms "
                              f"test={record['name']} operation={record['label']}")
                    break
            observed = {key: value for key, value in observed.items() if key in current}
            if reason:
                break
            time.sleep(0.02)
    finally:
        if reason:
            # A fast orphan can arrive before the first progress poll. Read its
            # still-active operation before terminating the blocked caller.
            for entry in events.glob("*.json"):
                try:
                    candidate = json.loads(entry.read_text())
                    if candidate["kind"] == "operation":
                        last_record = candidate
                except FileNotFoundError:
                    continue
            if last_record and "test=" not in reason:
                reason += f" last test={last_record['name']} operation={last_record['label']}"
            print(f"[nightly supervisor] FAIL {reason}", file=sys.stderr, flush=True)
        if child is not None:
            receipt = cleanup(child)
        # Delete only the allocated fixture generation, after owned processes
        # disappeared. shutil's fd-based traversal refuses substituted symlinks.
        current = root.lstat()
        if (current.st_dev, current.st_ino) != (root_identity.st_dev, root_identity.st_ino):
            raise RuntimeError("fixture root changed; retaining fixture")
        if not shutil.rmtree.avoids_symlink_attacks:
            raise RuntimeError("safe fixture cleanup unavailable; retaining fixture")
        shutil.rmtree(root)
        cleaned = True
        print(f"[nightly supervisor] cleanup={json.dumps(receipt)} fixtureRemoved={cleaned}",
              file=sys.stderr, flush=True)
    return 1 if reason else (child.returncode if child.returncode >= 0 else 1)


if __name__ == "__main__":
    try:
        if len(sys.argv) == 3 and sys.argv[1] == "--inspect":
            print(json.dumps(process_snapshot(int(sys.argv[2]))))
            sys.exit(0)
        budgets = [int(value) for value in sys.argv[1:4]]
        if len(budgets) != 3 or any(value <= 0 for value in budgets) or not sys.argv[4:]:
            raise ValueError("expected positive operation/test/shard deadlines and command")
        sys.exit(supervise(sys.argv[4:], *budgets))
    except (OSError, RuntimeError, ValueError, KeyError) as error:
        print(f"[nightly supervisor] FAIL CLOSED: {error}", file=sys.stderr, flush=True)
        sys.exit(1)
