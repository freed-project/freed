# PWA Stability Continuity

This document anchors the cross-machine continuation of the active PWA
stability closeout. The pull request discussion contains the current operational
prompt, exact build and evidence identities, remaining debt issues, authority,
provider constraints, and restart sequence.

The handoff is intentionally documentation only. It does not alter product
behavior, provider traffic, release state, or the global behavioral change
slot. The receiving machine must verify every mutable remote and local state
before continuing.

The canonical backlog remains GitHub Issues labeled `debt`. The canonical
runtime state remains under the private automation root on the machine that is
performing verification. Private credentials, owner confirmation files, lease
tokens, and machine-specific automation state must not be committed.
