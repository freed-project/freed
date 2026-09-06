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
