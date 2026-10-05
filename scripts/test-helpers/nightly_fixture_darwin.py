"""Darwin test custody: a private responsibility anchor and audit-token signals.

BSD/unique-ID ABI and signal binding match the reviewed preview helper at
44b617a87290094ed0fb545289184ae7b0381053. No preview lifecycle is imported.
The responsibility spawn attribute follows LLVM's PosixSpawnResponsible.h.
"""

import ctypes
import errno
import json
import os
import signal
import sys
import time


class BsdInfo(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint32) for name in (
        "flags", "status", "xstatus", "pid", "ppid", "uid", "gid",
        "ruid", "rgid", "svuid", "svgid", "reserved",
    )] + [("comm", ctypes.c_char * 16), ("name", ctypes.c_char * 32)] + [
        (name, ctypes.c_uint32) for name in (
            "nfiles", "pgid", "jobc", "tdev", "tpgid", "nice",
        )
    ] + [("start_sec", ctypes.c_uint64), ("start_usec", ctypes.c_uint64)]


class UniqueInfo(ctypes.Structure):
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


def system_library():
    lib = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
    lib.responsibility_get_pid_responsible_for_pid.argtypes = [ctypes.c_int]
    lib.responsibility_get_pid_responsible_for_pid.restype = ctypes.c_int
    return lib


def ensure_private_responsibility():
    """Re-exec only this supervisor, never change the terminal's attribution."""
    lib = system_library()
    if lib.responsibility_get_pid_responsible_for_pid(os.getpid()) == os.getpid():
        return
    marker = "FREED_NIGHTLY_RESPONSIBILITY_REEXEC"
    if os.environ.get(marker) == str(os.getpid()):
        raise RuntimeError("private Darwin responsibility was not established; refusing launch")
    attr = ctypes.c_void_p()
    attr_pointer = ctypes.POINTER(ctypes.c_void_p)
    lib.posix_spawnattr_init.argtypes = [attr_pointer]
    lib.posix_spawnattr_setflags.argtypes = [attr_pointer, ctypes.c_short]
    lib.responsibility_spawnattrs_setdisclaim.argtypes = [attr_pointer, ctypes.c_bool]
    lib.posix_spawnattr_destroy.argtypes = [attr_pointer]
    lib.posix_spawn.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_char_p,
                               ctypes.c_void_p, attr_pointer,
                               ctypes.POINTER(ctypes.c_char_p), ctypes.POINTER(ctypes.c_char_p)]

    def checked(result):
        if result:
            raise OSError(result, "Darwin responsibility spawn failed")

    checked(lib.posix_spawnattr_init(ctypes.byref(attr)))
    try:
        checked(lib.posix_spawnattr_setflags(ctypes.byref(attr), 0x0040))  # POSIX_SPAWN_SETEXEC
        checked(lib.responsibility_spawnattrs_setdisclaim(ctypes.byref(attr), True))
        original = getattr(sys, "orig_argv", None)
        if original is None:  # Apple's system Python 3.9 predates sys.orig_argv.
            argc = ctypes.c_int()
            values = ctypes.POINTER(ctypes.c_wchar_p)()
            ctypes.pythonapi.Py_GetArgcArgv(ctypes.byref(argc), ctypes.byref(values))
            original = list(values[:argc.value])
        arguments = [os.fsencode(sys.executable), *map(os.fsencode, original[1:])]
        environment = dict(os.environ, **{marker: str(os.getpid())})
        argv = (ctypes.c_char_p * (len(arguments) + 1))(*arguments, None)
        entries = [os.fsencode(f"{key}={value}") for key, value in environment.items()]
        envp = (ctypes.c_char_p * (len(entries) + 1))(*entries, None)
        pid = ctypes.c_int()
        checked(lib.posix_spawn(ctypes.byref(pid), os.fsencode(sys.executable),
                               None, ctypes.byref(attr), argv, envp))
        raise RuntimeError("Darwin SETEXEC unexpectedly returned; refusing launch")
    finally:
        lib.posix_spawnattr_destroy(ctypes.byref(attr))


class DarwinCustody:
    def __init__(self, observe_only=False):
        self.system = system_library()
        self.lib = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
        self.lib.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64,
                                         ctypes.c_void_p, ctypes.c_int]
        self.lib.proc_pidinfo.restype = ctypes.c_int
        self.lib.proc_listpids.argtypes = [ctypes.c_uint32, ctypes.c_uint32,
                                          ctypes.c_void_p, ctypes.c_int]
        self.lib.proc_listpids.restype = ctypes.c_int
        self.lib.proc_signal_with_audittoken.argtypes = [ctypes.POINTER(AuditToken), ctypes.c_int]
        self.lib.proc_signal_with_audittoken.restype = ctypes.c_int
        self.anchor = self.inspect(os.getpid())
        self.private = self.anchor and self.responsible(os.getpid()) == os.getpid()
        if not self.private and not observe_only:
            raise RuntimeError("Darwin supervisor lacks private responsibility; refusing launch")
        self.known = {}
        self.unresolved = []
        # Taken before any fixture child launches. These immutable process
        # lifetimes cannot descend from this newly established private anchor.
        self.outside = ({entry["uniqueid"] for entry, _ in self.snapshots()}
                        if not observe_only else set())

    def responsible(self, pid):
        return self.system.responsibility_get_pid_responsible_for_pid(pid)

    def inspect(self, pid):
        snapshot = BsdWithUniqueInfo()
        ctypes.set_errno(0)
        # XNU only searches zombproc for this flavor when arg is nonzero.
        # With arg=0, ESRCH means absent OR a still-present zombie.
        size = self.lib.proc_pidinfo(pid, 18, 1, ctypes.byref(snapshot), ctypes.sizeof(snapshot))
        if size != ctypes.sizeof(snapshot):
            if ctypes.get_errno() == errno.ESRCH:
                return None
            raise RuntimeError(f"cannot inspect Darwin process generation {pid}: errno={ctypes.get_errno()}")
        bsd, unique = snapshot.bsd, snapshot.unique
        return {"pid": pid, "parentPid": bsd.ppid, "uid": bsd.uid, "state": bsd.status,
                "zombie": bsd.status == 5,
                "birth": f"{bsd.start_sec}:{bsd.start_usec}", "uniqueid": unique.uniqueid,
                "parentUniqueid": unique.parent_uniqueid, "pidversion": unique.pidversion}

    @staticmethod
    def same(expected, current):
        return current is not None and all(expected[key] == current[key] for key in
                                          ("pid", "birth", "uniqueid", "pidversion", "uid"))

    def snapshots(self):
        capacity = 1024
        while capacity <= 65536:
            buffer = (ctypes.c_int * capacity)()
            size = self.lib.proc_listpids(4, os.getuid(), buffer, ctypes.sizeof(buffer))  # PROC_UID_ONLY
            if size <= 0:
                raise RuntimeError("Darwin process inventory failed")
            if size < ctypes.sizeof(buffer):
                break
            capacity *= 2
        else:
            raise RuntimeError("Darwin process inventory exceeded its bound")
        records = []
        for pid in buffer[:size // ctypes.sizeof(ctypes.c_int)]:
            if pid <= 1 or pid == os.getpid():
                continue
            before = self.inspect(pid)
            if before is None:
                continue
            responsible = self.responsible(pid)
            after = self.inspect(pid)
            if not self.same(before, after):
                continue
            records.append((after, responsible))
        return records

    def inventory(self):
        if not self.private or not self.same(self.anchor, self.inspect(os.getpid())):
            raise RuntimeError("Darwin responsibility anchor changed")
        records = self.snapshots()
        by_unique = {entry["uniqueid"]: entry for entry, _ in records}
        owned = {self.anchor["uniqueid"], *self.known}
        owned.update(entry["uniqueid"] for entry, responsible in records
                     if responsible == os.getpid())

        def ancestry(entry):
            # parentUniqueid is fixed at fork, including after reparenting.
            # Numeric PPIDs and current parent responsibility are not proof.
            visited = set()
            while entry["uniqueid"] not in visited:
                unique = entry["uniqueid"]
                if unique in owned:
                    return "owned"
                if unique in self.outside:
                    return "outside"
                visited.add(unique)
                parent = entry["parentUniqueid"]
                if parent in owned:
                    return "owned"
                if parent in self.outside:
                    return "outside"
                entry = by_unique.get(parent)
                if entry is None:
                    break
            return "unresolved"

        members, self.unresolved = [], []
        for entry, responsible in records:
            known = self.known.get(entry["uniqueid"])
            classification = ancestry(entry) if entry["zombie"] else None
            if (responsible == os.getpid() or (known and self.same(known, entry))
                    or classification == "owned"):
                self.known[entry["uniqueid"]] = entry
                members.append(entry)
            elif classification == "unresolved":
                # Do not invent ownership or signal this process. Its missing
                # ancestry could conceal an unseen fixture zombie, so it blocks
                # successful cleanup until it disappears.
                self.unresolved.append(entry)
        return members

    def send(self, expected, sig):
        phase = "inspect-before"
        current = responsible = responsibility_errno = None
        after, after_observed = None, False
        try:
            current = self.inspect(expected["pid"])
            if not self.same(expected, current):
                return False
            phase = "captured-generation"
            known = self.known.get(expected["uniqueid"])
            if not known or not self.same(known, current):
                raise RuntimeError("refusing an uncaptured Darwin process")
            if current["state"] == 5:  # SZOMB
                return False
            phase = "responsibility"
            ctypes.set_errno(0)
            try:
                responsible = self.responsible(expected["pid"])
            finally:
                responsibility_errno = ctypes.get_errno()
            if responsible != os.getpid():
                # A captured live process can exit between these two queries.
                # Only an unavailable responsibility with a verified exit may
                # settle without signaling. Query errors and foreign live
                # custody remain refusals; a zombie stays tracked by cleanup.
                if responsible == -1 and responsibility_errno in (0, errno.ESRCH):
                    phase = "inspect-exit-settlement"
                    after = self.inspect(expected["pid"])
                    after_observed = True
                    if after is None or (self.same(expected, after) and after["state"] == 5):
                        return False
                raise RuntimeError("Darwin process left the owned responsibility domain")
            token = AuditToken()
            token.val[5] = expected["pid"]
            token.val[7] = expected["pidversion"] & 0xffffffff
            phase = "audit-token-signal"
            result = self.lib.proc_signal_with_audittoken(ctypes.byref(token), sig)
            if result not in (0, errno.ESRCH):
                raise OSError(result, "Darwin generation-bound signal failed")
            return result == 0
        except (OSError, RuntimeError) as error:
            # Evidence only: a second snapshot must never turn refusal into
            # permission to signal, or replace the original failure.
            after_error = None
            try:
                if not after_observed:
                    after = self.inspect(expected["pid"])
            except (OSError, RuntimeError) as inspection_error:
                after_error = {"type": type(inspection_error).__name__,
                               "message": str(inspection_error),
                               "errno": getattr(inspection_error, "errno", None)}
            receipt = {"phase": phase, "target": expected["pid"], "signal": int(sig),
                       "expected": expected, "before": current, "after": after,
                       "afterError": after_error, "responsibility": responsible,
                       "responsibilityErrno": responsibility_errno, "anchor": self.anchor,
                       "error": {"type": type(error).__name__, "message": str(error),
                                 "errno": getattr(error, "errno", None)}}
            try:
                print("[nightly supervisor] Darwin signal refusal=" + json.dumps(receipt),
                      file=sys.stderr, flush=True)
            except (OSError, ValueError):
                pass  # A closed diagnostic stream must not mask custody refusal.
            raise

    def cleanup(self, child, reap):
        deadline = time.monotonic() + 5
        signaled, reaped = {}, []
        frozen = False
        while time.monotonic() < deadline:
            reaped.extend(reap(child))
            members = self.inventory()
            if not members and not self.unresolved:
                return {"signaled": list(signaled.values()), "reaped": reaped,
                        "remaining": [], "nonchildren": "confirmed disappeared, not waitpid-reaped"}
            # Freeze each verified generation before the final kill pass. No
            # group signals, and no scan inferred from reusable numeric PPIDs.
            running = [entry for entry in members if entry["state"] not in (4, 5)]
            if running and not frozen:
                for entry in running:
                    self.send(entry, signal.SIGSTOP)
            else:
                frozen = True
                # Root last. Nonchildren are reaped by their parents or launchd;
                # we require disappearance rather than treating zombies as done.
                for entry in sorted(members, key=lambda item: item["pid"] == child.pid):
                    if self.send(entry, signal.SIGKILL):
                        signaled[entry["uniqueid"]] = entry
            time.sleep(0.02)
        raise RuntimeError("Darwin cleanup deadline exceeded; retaining fixture; "
                           f"owned={members}; unresolved zombies={self.unresolved}")
