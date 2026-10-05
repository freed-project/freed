# Sample thumbnail proof

Use this check whenever a feature build or UI review populates a sample Library.

## Populate

Use `generateSampleLibraryData` through the existing sample import action in the task's isolated preview. Do not substitute an ad hoc text-only dataset. Keep the generated image metadata and sample fingerprints. Include posts and stories, with at least one record from each platform relevant to the feature. Keep stories current enough to appear in the intended view.

Feature previews must display the dataset's actual photographs. Never replace them with generated illustrations, placeholders, or unrelated images to pass a thumbnail check. Preserve the original media URLs and attribution. Loading and inspecting these existing public demo images is ordinary preview work and requires no additional authorization level. The demo site already loads them for visitors.

Keep network mocks confined to automated regression tests. Mocked delivery proves rendering behavior, not availability of the real photographs; perform a separate live-image check before handing over a preview.

## Check the actual surface

Inspect the current platform media policy first. Freed Desktop uses `reader-only` media for ordinary posts; stories use inline media. In feature previews, sample posts also display their original photographs. PWA uses inline media for both. Renderer memory pressure can suppress either. Report intentional suppression explicitly. Do not change the production policy or clear runtime memory diagnostics just to pass this check. If the requested preview requires thumbnails the policy suppresses, resolve that product decision with the owner.

Before navigation or seeding, record image error events and CSP violations so React cannot remove a failed image and make the check pass. Retain the seeded record IDs independently from the DOM. For each expected inline thumbnail:

1. Select the card by its `data-feed-item-id`, navigate to its view, and scroll it into view. For a virtualized feed, cover the seeded records through bounded batches or filters, rather than counting only the first viewport.
2. Require the card and its media image to exist and be visible. Match the image to the seeded media URL, so an avatar cannot satisfy the assertion.
3. Await `HTMLImageElement.decode()` with a bounded timeout. Require `complete`, positive `naturalWidth`, and positive `naturalHeight`. A URL string, HTTP success, image element, or gradient fallback is insufficient.
4. Fail on missing images, decode errors, recorded image failures, or relevant CSP blocks. Record the item ID, URL, platform, view, and failure. An empty selection must fail.
5. Capture the rendered post and story views and inspect the screenshots before handing over the preview. Report the source commit, seeded and checked counts, any network mocks used in tests, policy-suppressed records, and any unverified remote delivery.

## Existing regression checks

Run from `packages/pwa` with the pinned toolchain:

```sh
npm run test:unit -- src/lib/sample-data.test.ts
npm test -- tests/app.spec.ts --project=chromium --grep 'sample post and story thumbnails decode'
```

Use a fresh task-owned preview URL through `BASE_URL` when another PWA preview already owns the default port. The browser check uses generated sample records with mocked image responses and blocks external requests. It proves the rendering path, not remote catalog uptime.

The browser harness checks sample thumbnails under both inline and reader-only policies. The Desktop `feed-card-ui.spec.ts` action-flow test separately checks decoded story media and the intentional reader-only policy for unmarked posts. The existing release showcase capture checks remote image errors and CSP blocks as ordinary preview validation.
