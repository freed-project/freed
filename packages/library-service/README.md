# Freed Library service supervisor

`@freed/library-service` is the fail-closed Node 24 host foundation for one
headless Library Primary. It supervises the explicitly pinned
`library-authority-sidecar` binary from `freed-library-core`. Node never opens
the Library SQLite database or acquires its data-root lease.

The compiled `freed-library` CLI currently provides three commands:

```text
freed-library doctor --config /physical/path/service.json
freed-library status --config /physical/path/service.json
freed-library serve --config /physical/path/service.json
```

`doctor` validates only local prerequisites. `status` reads one private local
status record. Neither command starts the sidecar. `serve` revalidates every
prerequisite immediately before it starts one sidecar. The service exposes no
network listener.

## Configuration schema version 1

The configuration is exact-shape JSON. Its physical file must be owned by the
service user with mode `0600`. Data and state roots must be separate physical
directories owned by that user with mode `0700`.

```json
{
  "schemaVersion": 1,
  "role": "primary",
  "dataRoot": "/srv/freed/library-data",
  "stateRoot": "/srv/freed/library-state",
  "admissionFile": "/srv/freed/library-state/admission.json",
  "credentialDescriptorFile": "/srv/freed/library-state/credentials.json",
  "sidecar": {
    "executable": "/opt/freed/bin/library-authority-sidecar",
    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
    "startupTimeoutMs": 10000,
    "shutdownTimeoutMs": 5000
  }
}
```

Only the `primary` role is accepted in this slice. The executable must be a
root-owned physical regular file with one link in a root-owned physical path
hierarchy. Neither the file nor its hierarchy may be writable by a group or
other users. Its bytes must match the configured lowercase SHA-256. Linux
executes the already verified descriptor. macOS repeats the descriptor digest,
path identity, and canonical path checks immediately before launching the
protected path. No sidecar arguments or environment values are inherited.

This slice provides the production ACL proof on macOS. Linux descriptor
execution and process-group containment are covered, but `doctor` and `serve`
return `acl_probe_unavailable` until a bounded Linux ACL proof backend lands.
Every platform without the complete descriptor, containment, and ACL contract
fails closed.

The credential descriptor is also exact-shape private JSON. It contains a
record identifier, never credential bytes:

```json
{
  "schemaVersion": 1,
  "backend": "mounted-credential",
  "recordId": "freed-library-primary"
}
```

The supervisor accepts `os-vault` or `mounted-credential` as descriptor
syntax. The current native sidecar supports only `mounted-credential` and
fails closed for `os-vault` until task 11.5 provides the platform vault
adapter. A mounted record lives at
`<stateRoot>/mounted-credentials/<recordId>`. The directory must be a physical
directory owned by the service user with mode `0700`. The record must be one
physical file owned by the service user with mode `0600`, exactly one link,
and 1 through 65,536 bytes. `recordId` is a bounded token, never a path.
Absolute paths, separators, symlinks, hardlinks, broad modes, changed owners,
and oversized records fail closed. Reads use one fixed-size zeroizing buffer,
stop after the first byte beyond the limit, and recheck the same inode, owner,
mode, link count, and exact size before readiness.

`credentialsReady: true` proves only that the descriptor-bound sidecar could
securely open and read the exact local mounted material, then zeroize its
in-memory copy. The bytes remain opaque. The receipt does not prove that they
match a generic secret format, a Drive credential format, Google Drive
authentication, OAuth validity, cloud reachability, or writer admission. The
sidecar never interprets a Drive token and makes no provider request in this
slice. Generic or Drive-specific secret parsing remains unavailable until task
11.5 defines and approves that contract.

The admission record on fd6 is exact-shape JSON. It binds the operator's local
Primary admission to the start envelope, executable, both inherited root
identities, and the exact credential descriptor bytes:

```json
{
  "format": "freed_library_service_admission_v1",
  "schemaVersion": 1,
  "role": "primary",
  "configDigest": "0000000000000000000000000000000000000000000000000000000000000000",
  "executableDigest": "0000000000000000000000000000000000000000000000000000000000000000",
  "dataRootDevice": "1",
  "dataRootInode": "2",
  "stateRootDevice": "1",
  "stateRootInode": "3",
  "credentialDescriptorDigest": "0000000000000000000000000000000000000000000000000000000000000000"
}
```

`configDigest`, `executableDigest`, and `credentialDescriptorDigest` are
lowercase SHA-256 digests of the exact bound bytes. Device and inode values are
decimal strings. The sidecar proves EOF and rechecks exact file kind, device,
inode, owner, mode, link count, and size after reading fd3, fd6, and fd7. Any
drift stops startup before SQLite opens.

Before `doctor` or `serve`, create
`library-service-status.json` inside the state root as an empty file owned by
the service user with mode `0600` and one link. The supervisor opens this file
without following a symlink and holds that descriptor for the service
lifetime. Runtime status reads and writes never reopen the path. `status`
remains read-only and reports a null status when the file is absent.

The supervisor passes only fixed inherited descriptors. File descriptor 3 is
the verified executable, 4 is the data root, 5 is the state root, 6 is the
admission record, 7 is the credential descriptor, and 8 is an anonymous
lifetime pipe. A valid configuration cannot place service inputs beneath the
data root. Node never opens SQLite or another declared authority data file. The
native sidecar owns SQLite and its process lease. The sidecar derives its only
authority and credential paths from those open descriptors. It does not accept
paths, arguments, or environment variables from the supervisor.

The native sidecar never converts fd4 into an authority pathname. It opens and
locks `process.lock` with `openat(fd4)`, opens the physical `library-core`
directory with `openat(fd4)` and `O_NOFOLLOW`, then registers that held inode
under one opaque, closed logical SQLite name. A shared Unix VFS router resolves
only the fixed database, WAL, SHM, and rollback-journal leaves through
`openat` on that descriptor. Ordinary SQLite paths keep their normal operating
system behavior. No code changes the process working directory. The backup
directory and each backup file are also opened relative to fd4. Backup bytes,
restore staging, retention, and clearing operate through held descriptors.
The visible data-root path can therefore be renamed or replaced without
splitting the lease, SQLite files, or backups across roots.
Retention deletes only metadata whose backup ID, creation time, and file name
reconstruct one exact `sqlite-<nonnegative integer>.sqlite` leaf. Corrupt or
path-shaped metadata stays visible for repair and cannot reach deletion.

The startup control channel is inherited stdin and stdout. The supervisor
writes one bounded start record and closes stdin. The sidecar writes one
bounded ready record, closes stdout, and keeps running. The ready record must
echo a fresh parent nonce, every exact digest, and both root device and inode
identities. It must also attest that the authority, lease, admission,
credentials, and lifetime watchdog are active. Extra, malformed, oversized,
missing, or late records fail closed.

The sidecar runs in its own process group. Shutdown signals the group first,
closes the lifetime pipe, and proves that the group is gone before settlement.
A second signal sends an immediate group kill. Supervisor death closes the
lifetime pipe, which the verified sidecar must treat as a shutdown command.
Status and doctor output use only fixed reason codes and never include paths,
child output, or credential values.

On successful startup the native sidecar holds the data-root lease before it
opens SQLite, constructs the reusable staged checkpoint, status, and closed
backup authority, writes exactly one secret-free ready record, closes stdout,
and waits on fd8. This slice adds no socket or public listener. SQLite, WAL,
SHM, rollback journals, and backups stay beneath the descriptor-bound data
root and never enter service state or transport.
