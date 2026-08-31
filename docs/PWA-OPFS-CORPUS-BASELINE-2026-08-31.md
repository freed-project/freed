# PWA OPFS corpus baseline, 2026-08-31

## Identity and scope

This report records the first deterministic large-corpus evidence for the PWA
Library running on the real Chromium OPFS SAH pool.

- Chromium source base: `2586367f99bcdd46ba8f74348d88462ada900441`
- WebKit 100,000-item source base: `cf0a85710b3d5434ed6fc9b354afd5509a2dca11`
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

## WebKit 100,000-item envelope

The browser-selectable harness completed the full 100,000-item envelope against
WebKit 26.5 on a fresh isolated profile and origin. The run took 14.0 minutes.

| Measurement         |         25,000 items |        100,000 items |
| ------------------- | -------------------: | -------------------: |
| Feed page rows      |                   64 |                   64 |
| Feed page time      |              5.68 ms |              8.78 ms |
| Facet time          |             11.32 ms |              5.16 ms |
| Search rows         |                   32 |                   32 |
| Search rows scanned |                   32 |                   32 |
| Search time         |             23.28 ms |             53.02 ms |
| OPFS usage          |    413,360,340 bytes |  1,639,802,522 bytes |
| OPFS quota          | 20,615,843,021 bytes | 20,615,843,021 bytes |

WebKit kept the same bounded response and scan sizes as Chromium. Its feed,
facet, and search timings remained inside the contract budgets. The nightly
lane now runs the full envelope in both browser engines.

## Evidence limits

Chromium exposed `performance.memory`, not
`measureUserAgentSpecificMemory`, in this run. The heap values are page-level
snapshots after each checkpoint. They are not whole-process or dedicated-worker
peak memory. The checked-in nightly harness now also samples the page heap after
every bounded capture transaction and reports the largest observed value.

WebKit exposed neither supported browser memory API, so its measurement remains
`unsupported` with null byte values. This is an evidence gap, not a zero-memory
result.

Native scale, whole-process peak memory, quota exhaustion, and the remaining
crash and corruption matrix stay open under issue #1446. This report does not
claim those proofs.
