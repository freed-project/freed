# PWA OPFS corpus baseline, 2026-08-31

## Identity and scope

This report records the first deterministic large-corpus evidence for the PWA
Library running on the real Chromium OPFS SAH pool.

- Source base: `2586367f99bcdd46ba8f74348d88462ada900441`
- Browser: Chromium `151.0.7922.34`
- Fixture: provider-neutral RSS FeedItems generated in bounded 128-row signed
  transactions
- Test profile: fresh isolated browser profile and origin
- Total runtime: 17.8 minutes
- Pull request and release gates: none. This is a nonblocking hardening lane.

The fixture did not contact a provider, import a real Library, or exercise a
cloud account.

## Results

| Measurement              |      25,000 items |       100,000 items |
| ------------------------ | ----------------: | ------------------: |
| Feed page rows           |                64 |                  64 |
| Feed page time           |           6.24 ms |             8.61 ms |
| Facet time               |          53.55 ms |             8.43 ms |
| Search rows              |                32 |                  32 |
| Search rows scanned      |                32 |                  32 |
| Search time              |          20.50 ms |            49.44 ms |
| JavaScript heap snapshot |  46,297,083 bytes |    96,212,811 bytes |
| OPFS usage               | 411,045,496 bytes | 1,617,474,555 bytes |

Both checkpoints stayed inside the Library Core contract's warm bounded page,
facet, and search timing budgets. Feed and search response sizes remained fixed
as the fixture grew by four times.

## Evidence limits

Chromium exposed `performance.memory`, not
`measureUserAgentSpecificMemory`, in this run. The heap values are page-level
snapshots after each checkpoint. They are not whole-process or dedicated-worker
peak memory. The checked-in nightly harness now also samples the page heap after
every bounded capture transaction and reports the largest observed value.

Native scale, whole-process peak memory, WebKit scale, quota exhaustion, and the
complete crash and corruption matrix remain open under issue #1446. This report
does not claim those proofs.
