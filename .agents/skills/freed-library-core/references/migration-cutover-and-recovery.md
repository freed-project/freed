# Migration, cutover, and recovery

20. Elect one capable migration authority for the exact immutable Automerge
    source through the authenticated response-loss-safe candidate claim. Cloud
    claims expire only by authenticated store time. Local claims never expire
    and require explicit abandonment or winning cutover. Require the live exact
    claim and an exact payload-bound one-use grant for candidate registration,
    source contribution, fence reservation, fence activation, candidate-object
    commit, and cutover. Candidate registration is the first claim-bound
    authority mutation. While its registry entry is absent, no other operation
    grant may issue or consume. Registration and candidate-absent abandonment
    serialize over the same claim pointer and registry state. Cloud operations
    consume the grant in the authority store. Local operations bind it inside
    the same local control transaction. A cloud source grant binds a
    runtime-owned process generation and monotonic anchor created before grant
    acquisition. Commit requires the original nonserializable live attempt
    handle and the current runtime-owned generation. Serialized equality cannot
    revive an attempt after restart. A pause consumes the allowance but does
    not invalidate an otherwise timely attempt. A pause that exhausts the
    allowance, a restart, a missing live handle, a changed generation, or an
    invalid clock sample requires a fresh operation ID and grant. Cutover grants
    bind the closed transition-core payload, then the final certificate binds
    that payload, grant, and consumption without a hash cycle. Other
    installations prove adapter fixtures and bootstrap from the accepted
    checkpoint and operation segments. Do not make every browser decode the
    owner's private corpus. A second unreconciled permanent media vault blocks
    cutover.
21. Bound startup recovery by item count and elapsed time. Verify a referenced
    blob before exposing that entity, quarantine only affected state, and
    resume the remaining integrity scan from a durable background cursor.
    Never block startup on a full blob-corpus walk.
22. Keep every migration fence secret out of portable evidence. Persist only a
    domain-separated token digest in authority records, proofs, receipts,
    backups, and logs. The source owner generates and retains the private token
    only in protected, crash-recoverable operation state. A coordinator never
    publishes or retains it.
23. Serialize source-fence acquire, release, and abandonment revocation through
    one durable source-local authority domain. Prepare corpus-sized candidate
    work, prepared proof, reservations, and genesis closure before fence
    activation. Activate every fence only for the final bounded
    compare-and-swap window. Library Core v1 permits at most 64 local sources,
    65 fences including Automerge, a 2 MiB activation-evidence sidecar, 1,024
    sidecar objects, 65 source mutations, and 60 seconds. The sidecar contains
    only activation entries, authenticated-set nodes, the bounded final proof,
    and dependency-acyclic wrappers. It excludes the genesis closure, receipt,
    cutover payload, certificate, and manifest authentication object. Commit
    sidecar, final proof, receipt, cutover authority records, certificate,
    manifest authentication, and target tuple in one atomic authority bundle.
    No full decode, cache census, filesystem walk, external sort, arbitrary
    upload, closure mutation, or prepared-proof traversal runs while a source
    fence is active. While active, acknowledge a new source write only after
    its exact epoch-neutral replay intent is durable. Otherwise reject it before
    acknowledgment.
24. Decode Automerge through bounded external-memory runs. Never use
    `Automerge.load`, keep a source-sized change graph resident, or grant a
    large-host exception. A row consumer may stream only the exact
    receipt-bound payload range for its current row through a fixed buffer into
    an uncommitted target transaction. Rehash the complete spool after
    consumption and commit only after that verification succeeds. A scratch
    SQLite stage preserves counters as fixed-width sortable bytes, writes
    payloads through incremental blobs, verifies its exact schema catalog, and
    pins the bounded actor and head catalog from the verified layout. It commits
    change or operation rows, dependencies or successors, payloads, and the
    corresponding source receipt together. Exact retry returns that receipt
    only while the layout and receipted row, relationship, and payload counts
    remain complete. Every staged head must resolve to a staged change before
    the change receipt is accepted. Change and operation receipts in one stage
    must bind the same exact source identity. Missing rows, changed layout
    entries, dangling graph references, unreceipted rows, mixed sources, or
    changed input fail closed. Seal the complete stage only after actor
    sequences are contiguous, per-actor operation counters exactly close every
    change interval, and one bounded canonical digest covers every receipt,
    metadata row, relationship, and incrementally read payload byte. Exact
    seal replay recomputes that digest and rejects same-count semantic or
    payload tampering. The scratch schema enforces actor, change dependency,
    operation object and element-key references with foreign keys. Automerge
    document chunks intentionally omit delete rows. A successor therefore
    resolves either to one exact staged operation or to one reconstructed
    omitted-delete identity whose object and effective property or list-element
    target matches every predecessor. Reject explicitly encoded delete rows,
    unequal targets for one omitted delete, non-Lamport successor edges, and
    explicit successors attached to another target. Actor operation intervals
    close over the union of stored operations and reconstructed delete IDs.
    Derive the immutable current-operation set only after graph sealing.
    Preserve every visible non-increment operation whose successors are all
    explicit increments. Exclude increment rows themselves and operations
    superseded by any explicit non-increment or omitted-delete successor.
    Retain concurrent current operations without choosing a winner. Bind the
    exact set and payload bytes to the graph digest in a replay-checked receipt
    before object or entity materialization. The later resolved-value stage
    preserves every concurrent value, marks exactly one Lamport-maximum winner
    per effective map or list target, and applies explicit increment successors
    only to their current counter bases. Compute winners in one disk-spilling
    SQLite window pass instead of scanning all conflicts once per operation.
    Page counter bases through a fixed bound, reject orphan, non-counter,
    malformed, or overflowing increments, and bind the complete winner and
    counter projection to the sealed graph and current-operation receipts.
    The later sequence stage orders every list and text insertion through one
    disk-backed iterative depth-first walk. Visit concurrent siblings in
    descending Lamport order and descendants before the next sibling. Retain
    deleted insertions as ordering anchors without restoring their resolved
    values. Page objects, reject cross-object or non-sequence anchors, and bind
    exact replay to the graph and resolved-value receipts. This does not
    reconstruct objects or select registered product entities. The later
    FeedItem topology stage selects one winning `feedItems` map, admits only
    map-valued entities with bounded IDs, and reconstructs their winning map
    and sequence nodes in temporary SQLite. Omit deleted entities and their
    still-current descendants, densely renumber visible sequence values, cap
    nesting at 128 levels, and reject shared nodes, malformed container
    children, scalar parents with children, and replay drift. Bind the complete
    entity topology to the graph, resolved-value, and sequence receipts. The
    next document stage reconstructs binary-key-ordered maps, visible-order
    lists, text, and JSON-compatible scalar values from that topology. Limit
    each entity to 4 MiB, require its embedded `globalId` to equal the owning
    map key, preserve nonfinite floats through the canonical `__nonFinite`
    escape, reject unsafe integers, negative zero, bytes, unknown scalar
    extensions, malformed text chunks, and any user property that collides
    with the reserved nonfinite escape, and bind every exact JSON byte to a
    replayable document receipt. Keep temporary node values in SQLite and hold
    at most one bounded output plus one bounded child or scalar payload in
    native memory. Do not populate a published generation until the later
    schema-projection stage validates the complete FeedItem domain. That next
    stage must consume one receipt-verified document at a time and produce the
    exact shared shadow-row shape. Admit only faithful strings, booleans, and
    JavaScript-safe integers into typed columns. Preserve missing paths in
    `__absent`, unrepresentable values in `__raw`, unknown author and user-state
    members in their reserved rest objects, and full content in its dedicated
    JSON columns. Encode every projected JSON object in one recursive UTF-8
    key order shared by Rust and TypeScript, and reject reserved nonfinite tags
    or invalid Unicode instead of producing adapter-specific bytes. Reject
    negative zero because JSON cannot preserve its sign. Bind the complete row
    sequence and derived sort keys to the document receipt, then reproject and
    compare every row on replay. Do not batch complete projected documents in
    Rust memory or publish a generation before the row receipt closes. Populate
    the derived generation from one transaction-pinned scratch snapshot. Bind
    every bounded page to the complete row receipt, source operation indexes,
    and exact projected bytes. Resume from the destination's durable row count
    after response loss, and fail closed on source drift, oversized rows, or an
    incomplete page. Population does not publish or select the generation.
    Admission proves both the fixed memory ceiling and private staging capacity.
25. Build PWA reader manifests from both registered Cache namespaces and the
    durable logical lookup plan. Use one plan row and one probe per unique
    physical locator with sorted candidate bindings. Call only exact
    `cache.match` with every ignore option false and no network fallback.
    Persist one authenticated hit, missing, or error outcome for every plan row.
    Never enumerate the full Cache API key set. Resolve native reader files
    beneath one pinned root handle with
    no-follow semantics and reject links, reparse points, mount crossings, and
    root replacement. A mapped target identity must equal independently
    verified source identity.
26. Capture backups from one immutable checkpoint and media-vault generation,
    then release writers. Finalization may proceed across authenticated
    ordinary same-transition descendants without changing captured backup,
    bundle, delegation, or encrypted payload bytes. Keep one stable registration
    ID. Use a fresh attempt operation ID whenever the predecessor tuple,
    descendant proof, or signed certificate bytes change; exact retry means
    byte-identical attempt bytes. A busy library must not starve backup merely
    because new writes continue.
27. Commit cleanup through persistent candidate-census, source-fence, and
    terminal-disposition sets. Candidate size may delay physical deletion but
    never blocks ordinary legacy writes. An unreachable authoritative source
    blocks registered-candidate cleanup and a successor migration claim until
    it reconnects or is retired through policy. A claim abandoned before
    candidate registration uses the bounded candidate-absent cleanup branch:
    null candidate fields, canonical empty disposition sets, no source
    revocation, and no claim that unregistered temporary bytes were deleted. It
    is never blocked on source reachability. Same-library recovery is the
    cleanup-free authority escape hatch.
    Same-library recovery may supersede an active or abandoned lifecycle with
    its canonical proof before distributed cleanup. Later cleanup is garbage
    collection, not authority. Represent it with the recovery-supersession
    selector, signed disposition receipts, and the optional signed recovery-GC
    aggregate. Never fabricate an abandonment digest for an active-claim
    recovery.
