## 3. Runtime ownership

### 3.1 Native core

`packages/library-core-native` owns the native SQLite implementation. It owns:

- database identity, opening, catalog verification, and migrations
- writer epoch and process exclusion
- actor enrollment, capability verification, and journal admission
- registered mutations and materialization
- registered bounded queries
- checkpoint export, staging import, and activation
- operation, intent, and result segments
- content descriptors, local vault access, and garbage-collection reachability
- backup, restore, integrity checking, and recovery receipts

Freed Desktop and the headless Primary are hosts of this crate. Tauri does not
own Library SQL, schemas, query semantics, or mutation semantics.

On macOS and Linux, Freed Desktop opens the normalized database from a private
descriptor-bound `library-sqlite` directory. On Windows, Freed Desktop holds
one operating-system-backed process lease over the canonical application data
root, resolves the database beneath that root, rejects a symbolic final
component, disables SQLite URI interpretation, and uses a private SQLite
cache. Both adapters enforce the same one-way selector, schema, query,
mutation, checkpoint, and storage-epoch contract. The native query command
accepts a flat registered `queryId` request, removes that
discriminator, deserializes the remaining fields into the exact generated
request type, and returns the exact response DTO. Unknown query IDs and extra
fields fail closed. Raw SQL never crosses the native boundary.

Native and browser responses pass through one shared TypeScript dispatcher
bound to the original typed request before reaching a client. The dispatcher
selects the registered response parser by `queryId`, checks source fences,
cursors, row and byte bounds, nested limits, and exact closed fields, and
returns the request-specific response type. A host cannot widen or reinterpret
the result shape.

The PWA worker client also binds every non-query request to one exact result
parser before posting it. Its pending request retains the expected `result` or
`status` field and rejects a mismatched response member, unknown envelope
field, accessor, symbol, error code, oversized error message, or malformed
typed receipt. Checkpoint stages, scope actions, device-local mutations,
selective content, follower intents and results, normalized transport,
operation replay, and actor enrollment therefore cross the worker boundary as
closed values. A TypeScript cast is never a worker response validator.

The headless native boundary uses generated command protocol 1 over dedicated
inherited request and response descriptors. Each frame starts with one
four-byte unsigned big-endian payload length and cannot exceed 4 MiB. Requests
bind a 64-character lowercase hexadecimal request ID, one generated command
ID, and one exact command payload. The closed registry contains normalized
checkpoint begin, append, finalize, pinned export, registered query,
storage-inspection, Primary mutation context, native operation signing,
canonical transaction commit, follower-intent admission, actor transport
state, bounded result export, signed agent query admission, Primary actor
identity, and exact writer epoch reassignment commands. Startup must round-trip storage inspection and
match the generated SQLite application ID, contract version, schema version,
wire protocol version, and schema digest before the service reports running.
The same executable source generates the closed native error-code registry.
The Node command client validates exact success and refusal envelopes, binds
every response to its request ID, and retains a typed native refusal code
without accepting arbitrary error text. One bounded client now owns every
headless command exchange, including startup inspection and later actor work.
Unknown commands, extra fields, changed versions, malformed UTF-8, truncated
frames, oversized frames, response identity drift, and transport closure fail
closed. This command protocol never carries raw SQL, SQLite files, shell JSON,
whole-item JSON, Drive credentials, or authority private keys.

Local actor protocol 2 is generated from the same executable contract source.
It exposes exactly `execute_signed_query_v1` and
`submit_signed_intent_page_v1`. The service maps them to `agent_query_v1` and
`ingest_follower_intent_page_v1` on the one native command client. Protocol 1
is retired and receives no alias or compatibility listener. Local actors
cannot submit SQL, select native commands, bypass capability verification, or
receive an unregistered result shape.

One signed query carries canonical bytes capped at 256 KiB. Its body binds the
Library, active epoch, actor, exact capability certificate digest, random
request identity, registered query ID, and closed typed query. Native SQLite
recomputes the body digest, verifies the actor Ed25519 signature, loads the
active actor and capability, rejects retirement, proves the exact query grant,
and only then dispatches the existing bounded query program. The response
binds the request, query, capability, Library, epoch, and source revision to the
typed result. Library-wide capability scope is admitted. Provider and source
scopes fail closed until a query-specific scope predicate is part of the
generated contract. Socket ownership is transport privacy, never read
authority.

Native SQLite applies the same authority rule to writes. It verifies every
signed intent, actor, capability, storage epoch, causal frontier, and
transaction before an authoritative write. The actor submits only the signed
page. The Primary supplies the authoritative receipt time from its own service
clock.

Each local actor connection accepts one newline-terminated UTF-8 JSON request
and returns one newline-terminated closed response. A request frame is at most
1 MiB, a response frame is at most 1 MiB, at most 32 connections are active,
at most 120 new requests are admitted in one rolling minute, and the request
deadline is 5 seconds. The service retains at most 256 replay identities.
Exact request ID and byte replay coalesces onto the original response. Reusing
a request ID with changed bytes fails. Replay remains available while new work
is rate limited. Malformed frames, unknown methods, backend detail, oversized
results, transport loss, and exhausted capacity produce only closed protocol
errors.

On macOS and Linux, the service binds an owner-only mode `0600` Unix socket.
It proves the descriptor-bound state root before and after binding, validates
socket ownership and identity, removes only an owned private stale socket, and
never replaces a foreign path. A state root whose path exceeds the Unix socket
limit uses a stable owner-specific endpoint under `/tmp`, derived from the
canonical state-root identity and protected by the same ownership checks.
Shutdown closes every connection and removes only the exact socket inode it
created. Listener failure fences the Primary and kills the native sidecar.
The private service status record reports the active endpoint while the
listener is available.
Windows fails closed until service packaging supplies a named pipe with a
verifiable service-account ACL.

The installed host derives its service-manager definition from the same
already-bound configuration it will serve. The compiled CLI emits one
digest-bound macOS LaunchAgent plist or Linux systemd user unit with exact
Node, CLI, and config arguments. Both definitions run without a shell, apply
mode `0077`, and bind lifecycle settlement to the service process group.
Linux grants writes only to the configured data and state roots. Definition
generation never installs, loads, enables, or starts a service. Windows emits
nothing until its service-account named-pipe ACL and inherited-handle model can
be proven before any local actor request is accepted.

Linux readiness proves the complete path hierarchy through a pinned root-owned
`/usr/bin/getfacl` helper. Each bounded numeric result must contain exactly the
three owner, group, and other entries implied by the inspected mode. Any named
entry, mask, default ACL, malformed output, changed helper, missing helper, or
target identity drift fails closed.

The headless Primary mounted credential is one closed
`freed_library_primary_credentials_v1` record. It binds one lowercase
hexadecimal Library ID to one Ed25519 authority PKCS#8 key and one Ed25519
Primary actor PKCS#8 key. The record must be a single owner-only regular file
beneath the descriptor-bound private state root. Symbolic links, hard links,
changed metadata, growth during read, unknown fields, malformed base64,
foreign Library identities, and invalid keys fail before ready. The sidecar
holds decoded key bytes only in zeroizing native memory. The Node supervisor,
command frames, responses, logs, and SQLite never receive either private key.
The mounted backend is the provider-neutral installed-service contract. A
platform vault adapter may satisfy the same native custody interface later,
without changing a mutation or wire record.

### 3.2 Browser core

The PWA runs official SQLite WebAssembly in a dedicated worker and persists the
database in OPFS. It consumes the same contract source, SQL bytes, canonical
vectors, query DTOs, checkpoint records, intent codecs, and result codecs as
the native core.

IndexedDB is not a Library database or fallback. It may contain only a narrow
nonextractable-key record when WebKit provides no equivalent key facility.

### 3.3 Interface layer

`packages/ui` receives a platform-neutral generated client with named query and
mutation methods. It cannot import Tauri APIs, OPFS APIs, SQLite handles, cloud
transport clients, or storage implementations.
