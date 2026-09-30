## 5. Authority and writer epochs

One accepted authority tuple identifies:

- Library ID
- epoch number and epoch ID
- authority key ID and public key
- accepted manifest generation
- accepted operation frontier
- checkpoint frontier and materialized-state digest
- registry and protocol versions

Only the active Primary may allocate canonical actor sequences and accept
canonical transactions. Freed Desktop may host the Primary. The headless
service may host the Primary. A follower never promotes itself because the
Primary is unreachable.

An authority transition is a signed compare-and-swap from one exact accepted
tuple to one successor tuple. Competing transitions select one winner by the
registered deterministic rule. A stale, sibling, downgraded, unknown-version,
or wrong-key writer fails before mutation.

Direct writer reassignment is retired. Desktop no longer registers
`reassign_normalized_library_writer_epoch`; the native command catalog no longer
registers `reassign_writer_epoch_v2`. The latter returns `command_unknown` without
mutation, including under replication protocol 2. Production successor installation
uses the fenced cooperative handoff path. Historical certificate decoding remains
available for existing Libraries; decoding a certificate does not grant authority.

Source cancellation permanently retires that readiness identity on the source
installation. Its exact readiness bytes and original cancellation time commit in
a local ledger with restored source admission. Replacing the current handoff does
not erase that ledger, and a canceled readiness cannot start another handoff.
Target preparation remains fenced until it receives valid transfer consent or a
verified cancellation path. Missing local consent does not prove that the source
has not already authorized the transfer.

Production source cancellation signs a closed proof under the predecessor key
and commits its exact bytes with restored admission and the cancellation ledger.
A missing key or failed proof write rolls the whole cancellation back. An exact
retry verifies the stored proof and returns it without loading or replacing the
key. Native status exposes the retained proof for copying after restart. The target verifies the exact saved readiness, selected predecessor and enrolled
actor before retaining the proof and returning to consumer operation. Cancellation
never grants writer or provider admission. Retrying a committed cancellation
preserves its exact bytes. Preparing again requires a later local timestamp, a
new readiness identity and the retained pending key; delayed old authorization
cannot revive the canceled transfer.

Cancellation history can verify a later direct successor without granting edit
admission in that epoch. Verify the retained predecessor signature and the exact
successor certificate against its canonical authority fields, unique active
Desktop actor and follower receipt. Local cancellation of any referenced readiness
identity contradicts that successor and must fail closed. Recovery preserves the
ledger while atomically archiving the old enrollment and intents before explicit
reenrollment. This path does not skip intermediate authority epochs.

A settled, reenrolled consumer can prepare as a later handoff target. Native
preparation verifies its exact committed recovery receipt and current enrollment
before replacing the completed lifecycle record. Archives and replacement links
remain intact. Completed recovery lookup uses an indexed Library, epoch and
receipt-digest key, verifies exact retained request bytes and rejects ambiguity.
The transfer fence still blocks edits until verified cancellation or activation;
recovery metadata alone grants no admission. The transfer panel keeps bounded archive discovery and verified review available
during transfer and after promotion to Primary. These views are read-only;
Primary reapplication remains unfinished.

Verified target activation archives its complete settled consumer history before
retiring the live consumer slots. Archive creation, slot retirement and local
writer admission share one native transaction. A late failure restores the live
rows and leaves the target fenced. Exact activation retry reuses the committed
result without creating another archive. Query invalidation sequences remain
monotonic. Original signed edits and their old enrollment certificate remain preserved.
When promotion moves the actor record to a new epoch, archive review verifies the
retained authority-signed enrollment certificate against the historical authority
before checking the original envelopes. The historical snapshot is read-only and
cannot grant current edit rights. This does not reapply edits as Primary. Full repeated promotion/demotion acceptance remains pending.

Return preparation from a demoted source requires current successor selection,
accepted consumer enrollment, retained actor key, settled intents and no writer
admission. Verify the retained authorization against the selected successor's
signed transition certificate. Persist exact authorization and adoption bytes in
`library_local_source_demotions` before replacing the source singleton, within
the same FULL transaction. The installation-local ledger survives checkpoint
imports, is excluded from logical checkpoints and grants no authority. Preparation
keeps the target fenced until the ordinary verified publication and activation.


### Consumer admission after multiple transfers

A consumer may verify a chain from its selected authority to the final successor
without selecting intermediate epochs. Certificate discovery grants no authority.
Each transition must authenticate the exact predecessor checkpoint reference,
nonregressing source revision and enrolled target under that predecessor's key.
An actor row from the latest checkpoint cannot substitute for historical
enrollment because promotion replaces that row's epoch and role.

Final activation verifies every staged historical checkpoint's canonical bytes,
digest, identity and enrollment in the transaction that replaces selected state.
It retains original local enrollment and intents for explicit recovery. Old
signed edits never acquire a new epoch by relabeling. A later same-epoch refresh
pins the accepted final authority and retained verified chain while that recovery
is pending. Historical authority rows remain available after temporary staging
is consumed.

Only successfully consumed historical stages are deleted, in the same activation
transaction. Failure restores both selected state and recovery inputs. Unrelated
staging and local recovery archives are excluded from this deletion. Current
attempts are bounded to 32 transitions, each at most 16 KiB. Longer chains fail
closed; this bound is not a claim of arbitrary offline-duration recovery.
