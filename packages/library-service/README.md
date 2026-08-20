# Freed Library service supervisor

`@freed/library-service` is the fail-closed Node 24 host foundation for one
headless Library Primary. It supervises one explicitly pinned native authority
sidecar. Node never opens the Library SQLite database or acquires its data-root
lease.

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
  "backend": "os-vault",
  "recordId": "freed-library-primary"
}
```

`backend` may be `os-vault` or `mounted-credential`. The descriptor identifies
a record but cannot contain credential bytes. The sidecar must prove that both
admission and credentials are usable in its bounded ready record. Missing or
changed prerequisites stop startup with no surviving child process group.

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
future native sidecar owns SQLite and its process lease.

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
