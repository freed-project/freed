## 13. Migration and cutover

Migration is one bounded external-memory read of retained source data directly
into the final SQLite schema. It is not a product runtime and cannot be selected
after cutover.

The migration records one disposition for every source field and content
object:

- mapped to a registered final field
- retained as immutable provenance required by the product
- explicitly excluded because it is device local or obsolete
- blocking because lossless interpretation is unavailable

Any blocking disposition prevents cutover. The migration never creates a
shell, shadow database, dual write, alternate PWA row store, or compatibility
checkpoint.

The native FeedItem decomposer uses the generated capture materializer for the
typed root, media, and topics. It separately preserves tags, highlights,
content-signal scores and tags, and event candidates. Reader bodies, highlight
text, and event evidence above 65,536 UTF-8 bytes become content-addressed blob
descriptors and chunks inside the same target transaction. Exact descriptor and
chunk replay is verified before the row can commit. No whole FeedItem JSON or
shell record enters the final database.

The shell decomposer writes RSS feeds, Persons, Accounts, Person tags,
reach-out events, Account follow roles, and typed preference leaves through the
same generated mutation programs used after activation. It inserts Persons
before Accounts and refuses a dangling Person reference. Reach-out rows use a
deterministic content-bound migration identity and retain the source order and
exact optional fields. Preference ownership lives in the executable SQLite
contract source consumed by both TypeScript and Rust. Device-local fields and
unknown obsolete fields are excluded before `json_tree` creates canonical
preference nodes. The decomposer never stores or hashes the source shell.
Historical Friend objects are derived compatibility projections. They are
excluded when their canonical Person and Account sources are present, and they
block migration when those normalized sources are absent.

The native candidate builder holds one SQLite read transaction over the old
authority. Its inert receipt binds the old library ID, epoch, transition
certificate, source document digest, generation, source revision, SQLite
revision, and a bounded digest of the ordered causal frontier. It records live
FeedItem and normalized root counts plus the exact number of deleted historical
FeedItem rows excluded at the epoch boundary. The target is accepted only when
all root counts and foreign keys close. Its product digest streams canonical
normalized records across bounded export pages. It never uses the source shell
or a whole-corpus serialization as evidence, and it cannot activate or select
the target database.

The normalized storage transition certificate advances the old authority by
exactly one epoch. It must use the already accepted authority key and binds the
entire migration receipt, selected Primary writer, acceptance time, contract,
schema and protocol versions, schema SHA-256, and normalized checkpoint format.
The transition body digest names the new epoch. A separate digest identifies
the complete signed certificate. Both the epoch signature and authority-key
possession signature are verified before installation.

Candidate authority installation rechecks the old state revision, source
identity, active authority tuple, key lineage, causal-frontier digest, and live
plus excluded item counts. It rehashes the target product through bounded
checkpoint pages, then installs the signed epoch, carried causal frontier,
active Primary writer, writer admission, normalized metadata, and
materialization generation in one target transaction. Any changed source,
candidate byte, certificate byte, signature, count, or foreign key leaves the
target inert. Installation does not select the target file or retire the old
writer. Those actions belong to the later host compare-and-swap barrier.

The installed normalized epoch enrolls a fresh Primary actor from the host's
existing actor-key store. Its version 2 certificate is signed by both the actor
and accepted authority key, binds the complete carried causal frontier, and
grants exactly the generated Primary-writer mutation set under a library-wide
scope. The native verifier checks the certificate before one transaction
inserts the actor, capability, and closed mutation rows. No retired operation,
legacy editor policy, inferred mutation, or blank-frontier enrollment can enter
the normalized epoch.

Freed Desktop has one descriptor-bound local authority selector. The selector
is a private, bounded, canonical closed record under the already leased app-data
root. It permanently selects normalized SQLite for one Library. It does not
duplicate the live epoch, transition certificate, actor, or materialization
generation. Every read verifies the selected Library and one internally
consistent active authority plus generation inside SQLite. Writer transfer
advances SQLite authority without changing this one-way selector. Once valid,
all historical database, journal, store, backup, restore, clear, and mutation
opening paths fail closed for the rest of the process and after restart. A
missing selector preserves the pre-cutover state. A malformed selector or one
that does not match normalized SQLite activates neither side.

Production renderer startup accepts only a verified normalized SQLite
selection. If native startup cannot complete migration or fresh genesis, the
renderer stops before loading Library state or opening a historical mutation
path. Existing historical bytes remain untouched for diagnosis and retry. The
renderer never creates a portable shell, promotes historical storage, or
chooses a fallback authority. Browser-only test harnesses may supply an
isolated in-memory view fixture after reporting normalized authority, but that
fixture cannot create or select product storage.

The renderer asks native code for one mutation context. Native code returns a
Primary context only after this selector verifies. Before selection, the same
request can resolve only to an enrolled follower intent context or no Library
Core mutation authority. The shared TypeScript assembler is identical in both
cases. The final transport either commits the canonical envelopes through the
selected Primary or appends them to the follower intent outbox. It never writes
both and never treats a populated migration candidate as runtime authority.
After a Primary commit, Freed Desktop reads the new source revision and corpus
total through the normalized facet query. It resolves only the changed visible
item identities through exact normalized detail queries. The mutation tail
cannot reopen historical count, shell, or item storage after the selector has
retired those paths.

Selector publication writes canonical bytes to a private pending file, flushes
the file, atomically renames it to the one final selector name, and flushes the
bound directory. The final name is never overwritten with different bytes.
An exact response-loss retry succeeds only when the stored bytes match. The
selector is read back and reverified before cutover reports success.

Candidate construction commits one local transition plan in the same SQLite
transaction as the normalized product rows. The plan contains the canonical
migration receipt, a domain-separated receipt digest, and no shell or whole
item. It is excluded from checkpoint export because it is local cutover state,
not synchronized Library data. Restart resumes only from those exact bytes. A
changed, malformed, or noncanonical plan fails before authority installation.

Authority installation and local Primary actor enrollment are exact replay
operations. After response loss, authority recovery verifies the full signed
epoch tuple, active writer, admission row, Library metadata, materialization
generation, and complete frontier. Actor recovery reconstructs the expected
certificate from the stored keys and transition identity, then verifies the
complete actor row, capability certificate, and every generated mutation
grant. Merely finding existing rows never counts as success. Missing, extra,
or changed rows fail closed.

A fresh Freed Desktop installation starts directly in normalized SQLite. The
renderer first asks whether a normalized selector already exists. Only when it
does not exist does it inspect the retired IndexedDB metadata for historical
Library presence. Native startup then also proves that every historical
Library table except its schema metadata is empty. The reusable Rust core
derives one stable Library identity, creates or reads back the authority key,
signs `freed_normalized_fresh_genesis_certificate_v1`, installs the empty
normalized authority and Primary actor, and publishes the selector in the same
app launch. It never creates an empty shell, historical authority, or migration
candidate. Exact retry reconstructs and verifies the stored certificate and
actor. A different installation witness, changed key, changed product digest,
partial authority, or any historical row fails closed.

The native Desktop cutover preparation operation owns the stage sequence. It
creates the candidate only when none exists, binds the installation witness and
first acceptance time once, installs the signed authority, enrolls the local
Primary actor, and returns one selector-ready receipt. Its local plan advances
monotonically from `candidate` through `authority_installed` to
`actor_installed`. A restart with the same installation witness returns the
same receipt. A different witness, changed source fence, changed certificate,
or changed installed row fails before selector publication.

After selector publication, renderer bootstrap performs two bounded queries:
the maintained Library facet summary and the normalized preference snapshot.
It does not read a shell or hydrate FeedItem, Feed, Person, or Account maps.
Those collections enter React only through the bounded query window owned by
the view that requested them. Browser-only UI fixtures may retain a synthetic
projection, but that fixture is not a production storage or transport path.

Desktop and PWA navigation validate only the currently selected item through
one exact `item_detail_v1` point query. Navigation does not subscribe to a
corpus or construct a complete item-ID set. A missing row clears the selection,
a failed query proves nothing, and a late response cannot clear a newer
selection. Each host injects its typed point reader into the shared hook. The
root app never tries to consume its own Platform context while that context is
still being constructed.

The always-mounted Header and the command palette share one bounded
`item_detail_v1` lifecycle keyed by item identity and source revision. One
host reader retains at most one detail row and deduplicates concurrent requests.
A changed identity or revision immediately fences the previous row. Pending,
missing, and failed reads remain distinct interface states, so the Header never
shows list controls merely because the current point query has not settled.
Neither surface subscribes to the renderer item collection.

Desktop background services follow the same rule. Snapshot summaries read the
maintained Friend count from `facet_summary_v1`. Content fetching accepts exact
changed rows for incremental work and uses `content_fetch_page_v1` for a full
replacement scan. Neither service reads the renderer's item, Person, Account,
or Friend maps.

An active Feed or provider-author filter resolves through
`filter_scope_summary_v1`. The request contains exactly one Feed URL or one
provider plus external author ID. SQLite returns one nullable display label and
one exact visible-item count under a 16 KiB response ceiling. Author scopes
also return the nullable stable Account ID selected by the same indexed
provider and external-ID lookup. Feed URL scopes must return a null Account ID.
Feed author navigation consumes that scalar directly, creates a typed Account
mutation only when SQLite reports no matching row, and never scans or retains
the Account catalog. Feed subscription presence comes from the maintained
facet row, so the Feed surface subscribes to neither the RSS Feed catalog nor
the Account catalog. Feed URL, provider-author, and item predicates use their
normalized indexes. Header and Feed do not subscribe to Feed, Account,
per-Feed count, per-platform count, or total item dictionaries. React retains
only the active scope result and visible feed windows.

Exact item lookups use `item_detail_v1`. Background enumeration uses
`background_item_page_v1` with an opaque source-fenced cursor and a 64-row
window. Its closed nullable `analysisVersion` selector makes SQLite return
only items whose normalized analysis row is missing or uses a different
version. The shared batch reader retains at most 1,000 candidates, pins every
page to one source revision, and reports only whether another bounded batch
exists. Freed Desktop's local semantic classifier infers content signals and
event candidates for that batch, rechecks the source revision, and commits one
or more bounded signed `feed_item_analysis_replace` transactions. It never
receives a corpus, fabricates a completion summary, or writes through a generic
maintenance command. Mutation target discovery applies its product predicate while each
page is visible and never invokes the historical offset reader. Workflows that
still collect a complete identity or URL set must move to durable scope staging
or a narrower aggregate before the final memory gate. The same page contract
serves capture maintenance, import identity checks, and saved-media discovery
until those narrower contracts take ownership.

Partial Person, Account, and RSS Feed edits never assume that React holds the
entity. They read one exact `person_detail_v1`, `account_detail_v1`, or
`rss_feed_detail_v1` row, merge the requested fields into that closed record,
and submit a complete typed mutation. The current visible renderer object may
avoid that query, but it is a cache of the same bounded detail contract, not
durable authority. Batched RSS refreshes resolve each missing feed through the
same exact query before applying refreshed fields, so a sparse renderer cannot
erase polling policy, unread behavior, folder, URLs, or sample provenance.

Complete RSS Feed maintenance never derives its target set from React. The
native boundary freezes the matching `library_rss_feeds` primary keys inside
one immediate SQLite transaction. Removal stages every feed. Title repair
stages only feeds whose title is `Untitled Feed` or still equals the feed URL.
The installation-local stage records typed `entity_id` values, pages at most
1,000 identities at a time, and is excluded from checkpoints and replication.
Each page becomes bounded canonical transactions, with no complete URL array
in renderer memory. Retrying an ambiguous freeze response must repeat the same
stage ID, action, request digest, and creation time. Any changed replay fails
closed.

Cutover requires source fencing, final SQLite catalog verification, field and
content closure, query parity beyond the former hydration cap, checkpoint and
backup proof, follower import proof, exact receipt publication, and owner
activation authority. One SQLite-only storage epoch is then selected.
The fenced Desktop source reader accepts only historical schema versions 6
through 12, the complete predecessor range that carries the stable product and
authority fields consumed by the migration. It verifies the exact application
identity, required columns, and database integrity, opens the source read-only,
and performs no historical schema upgrade.

Rollback is legal only before a later canonical SQLite write and only to the
same accepted frontier. After a later write, recovery rolls forward from typed
checkpoints, operation segments, content objects, and authenticated backups.
