# Delivery34 independent second review

All nine final avatar variants pass at the reviewed 220 and 48 pixel sizes. Edmund passes with the published hires variant, not the earlier medium file. Both seed display variants preserve the approved full framing and the visible events supporting their prose.

This is a delivery substitution review, not a new media admission or a new episode count. I opened the actual screenshots and reference imagery described below. No network requests, image edits or runtime writes were performed by this reviewer. The lead supplied the downloads and rendered the screenshots.

## Avatar evidence

Final input: `/tmp/freed-avatar-delivery-34/reviewed-dimensions.json`. Actual sheets opened: `/tmp/freed-avatar-delivery-34/review-1.png`, `review-2.png`, `review-3.png`. The final first sheet was reopened after Edmund changed to hires. The cached `render.mjs` uses the existing runtime crop helper, a 256 pixel canvas, and 220/48 CSS circles. I independently verified all nine local byte counts, SHA1 hashes and decoded dimensions against the input.

| Identity | Final dimensions | Crop source square, pixels | Finding |
| --- | --- | --- | --- |
| maud-overhead | 1857 x 1238 | 999.80 | PASS. Open bill, eye and shaggy throat remain clear at 220; the heavy bill silhouette survives at 48. The bill edge meets the circle as in the approved crop. |
| edmund-oldring | 1333 x 2000 | 333.25 | PASS. Final hires variant passes. Orange bark grooves and dark scar remain readable at 220; the broad central trunk remains distinct at 48. Same framing as the approved botanical27 circle. |
| agnes-splinter | 615 x 1000 | 429.42 | PASS. Red crest, black malar stripe and pale striped face remain readable at 220; crest and profile remain distinct at 48. No second bird enters. |
| otis-gulp | 1296 x 864 | 500.00 | PASS. One white pelican head and open orange bill remain clear at both sizes. The left bird in the full photograph remains outside the approved circle. |
| hester-sweetlip | 1000 x 666 | 237.86 | PASS. Pale hanging flower and separate water droplets remain visible at 220. The pale flower silhouette survives at 48. Slight texture softness is acceptable and does not erase the flower shape. |
| ambrose-armful | 864 x 999 | 480.00 | PASS. White flower, green buds and ribbed spiny arm remain clear at 220; flower and diagonal arm remain distinct at 48. Same flower and branch framing. |
| oswin-broadback | 1379 x 919 | 474.87 | PASS. Eye, muzzle, dark forehead and curved horn remain clear at 220; horn and head silhouette survive at 48. Background body remains secondary. |
| hugo-rim | 1500 x 1000 | 625.00 | PASS. Shield outline, orange rim and attached shell cluster remain visible at 220; shield silhouette survives at 48. Some surface softness also exists in the wet original. No material new loss at these display sizes. |
| cedric-crown | 500 x 333 | 317.38 | PASS. Open mouth, dark neck and antler branches remain readable at 220; elk profile and antlers survive at 48. Peripheral antler clipping matches the existing crop. |

### Edmund correction

The earlier medium file was 666 x 999 pixels. At zoom 4, only 166.5 source pixels spanned the square, which visibly softened the bark at 220. I recommend against that medium file for the shared 220/48 binding. The final 1333 x 2000 hires file gives 333.25 source pixels across the square, removes that enlargement and restores the bark grooves. I compared its actual final 220/48 circles with `output/playwright/botanical27-avatars-final.png`. Both retain the same scar, trunk edges and surrounding trees. Hires passes; no return to the 7.8 MB original is needed for these sizes.

Ambrose is actually 864 x 999 although the published label says 864 x 1000. This one-pixel rounding difference does not cause a visible framing change. Hester has 237.86 source pixels across the crop, slightly fewer than the intermediate 256 pixel canvas but more than the 220 display. The actual flower and droplets remain adequate; there is no reason to reject it from arithmetic alone.

### Compared approved references

- Bird25 original 220 circles opened: `/tmp/freed-bird25/maud-overhead-220-circle.png`, `agnes-splinter-220-circle.png`, `otis-gulp-220-circle.png`; exact source mappings and focal values in `docs/drafts/BIRD-REGULAR-25-AVATARS.json`.
- Land20 original 220 circles opened: `/tmp/freed-land20/oswin-broadback-220-circle.png`, `cedric-crown-220-circle.png`; mappings in `docs/drafts/LAND-REGULAR-20-AVATARS.json`.
- Botanical originals at both sizes opened in `output/playwright/botanical24-avatars-final.png` and `output/playwright/botanical27-avatars-final.png`.
- Hugo exact original opened: `/tmp/freed-aquatic-26/source-22.jpg`, SHA1 `138b1f4310eb86ea5dad30057d31a2538eb2facd`, 6000 x 4000. Existing avatar source and focal are recorded in `docs/drafts/AQUATIC-REGULAR-26-AVATARS.md`. Its wet, muted surface is present in the source.

### Exact final delivery files

- **maud-overhead**: `/tmp/freed-avatar-delivery-34/maud-overhead.jpg`; 589,404 bytes; SHA1 `cec043d2c844167cbdb7210236bb69d496d6a8aa`. Published delivery URL: https://npgallery.nps.gov/GetAsset/a567575a-b8a1-476f-a265-ee192d76202f/proxymdres.jpg? Focal: `{"x": 0.6595773320769955, "y": 0.4643650312941652, "zoom": 1.23825}`.
- **edmund-oldring**: `/tmp/freed-avatar-delivery-34/edmund-oldring-hires.jpg`; 1,439,591 bytes; SHA1 `7f295dfe39649fc07595fa907fb8e19a01e4c397`. Published delivery URL: https://npgallery.nps.gov/GetAsset/f40fb656-8d8a-4e91-a8d3-66c4d7fa2dd9/proxyhires.jpg? Focal: `{"x": 0.525, "y": 0.62, "zoom": 4}`.
- **agnes-splinter**: `/tmp/freed-avatar-delivery-34/agnes-splinter.jpg`; 296,625 bytes; SHA1 `0f1ac788c494027725127cb0f68c506dd16d919b`. Published delivery URL: https://npgallery.nps.gov/GetAsset/9f25eeeb-6505-4a2f-89c3-2c2c484f176f/proxymdres.jpg? Focal: `{"x": 0.3673345476624165, "y": 0.28950317519611507, "zoom": 1.4321739130434783}`.
- **otis-gulp**: `/tmp/freed-avatar-delivery-34/otis-gulp.jpg`; 334,662 bytes; SHA1 `d7427660e2bae35e5afca4939195c4389fe8d031`. Published delivery URL: https://npgallery.nps.gov/GetAsset/cfb3b7d5-1b5e-4fb5-8bec-24b3852ded83/proxymdres.jpg? Focal: `{"x": 0.6944444444444444, "y": 0.4774305555555556, "zoom": 1.728}`.
- **hester-sweetlip**: `/tmp/freed-avatar-delivery-34/hester-sweetlip.jpg`; 141,910 bytes; SHA1 `5977c7d0b73b98b2c4e52e218e5a0de89d88ffa8`. Published delivery URL: https://npgallery.nps.gov/GetAsset/52f2199f-cd0c-4e07-aa14-60ef140794fc/proxymdres.jpg? Focal: `{"x": 0.575, "y": 0.375, "zoom": 2.8}`.
- **ambrose-armful**: `/tmp/freed-avatar-delivery-34/ambrose-armful.jpg`; 301,669 bytes; SHA1 `2956bced80e3229e2edfcfff936bf2680716a99d`. Published delivery URL: https://npgallery.nps.gov/GetAsset/0acb7148-a0d1-4dc1-894b-c883fbf42429/proxymdres.jpg? Focal: `{"x": 0.58, "y": 0.49, "zoom": 1.8}`.
- **oswin-broadback**: `/tmp/freed-avatar-delivery-34/oswin-broadback.jpg`; 483,556 bytes; SHA1 `85bd8f53892d62285f731671caa28a09c9549d89`. Published delivery URL: https://npgallery.nps.gov/GetAsset/24cf3ee7-cc6e-4f00-81c0-5e266b063f2d/proxymdres.jpg? Focal: `{"x": 0.3353879622915156, "y": 0.5303236333967909, "zoom": 1.9352631578947368}`.
- **hugo-rim**: `/tmp/freed-avatar-delivery-34/hugo-rim.jpg`; 527,454 bytes; SHA1 `e2f0de0030482445fe9444b24030d643bf9db1d4`. Published delivery URL: https://npgallery.nps.gov/GetAsset/7ce54b8e-c3b3-4cfa-98f1-cdd7b4785ebd/proxymdres.jpg? Focal: `{"x": 0.35, "y": 0.56, "zoom": 1.6}`.
- **cedric-crown**: `/tmp/freed-avatar-delivery-34/cedric-crown.jpg`; 49,732 bytes; SHA1 `5c381ed88abc5d15cf156f0fdee315b5518f2beb`. Published delivery URL: https://npgallery.nps.gov/GetAsset/3e3d8f05-cb47-4544-b1ec-2b9bb3827c0f/proxylores.jpg? Focal: `{"x": 0.4931640625, "y": 0.47653958944281527, "zoom": 1.0492307692307692}`.

## Seed variants

Both exact delivery files and both exact original files were opened separately. No crop or scene substitution is visible. These are the existing USFWS public-domain photographs, with their attribution and original media identity retained.

### Packed carefully, botanical27-04

- Original: `/tmp/botanical27/fws-seed-pod.jpg`, 5760 x 3840, SHA1 `ca31302fd2a8d2f2efcaff6001a6ca9cb2dcf952`. Ryan Hagerty/USFWS. Source: https://www.fws.gov/media/milkweed-seeds-pod . Original URL: https://www.fws.gov/sites/default/files/images/2014-10/16258.jpg
- Delivery: `/tmp/freed-seed-delivery-33/packed.jpg`, 1300 x 867, 663,578 bytes, SHA1 `0191b63c70c956b6d34dd481cdd4f92c820de2e0`.
- Delivery URL: https://www.fws.gov/sites/default/files/styles/max_1300x1300/public/images/2014-10/16258.jpg?itok=ePGQUfrb
- PASS. Overlapping brown seeds remain individually outlined, with pale compressed silk behind and the same pod wall on the left. The ordered packing supporting the caption is clear. Background and framing remain intact.

Preserve exact prose:

> Every seed tucked against the next. No wasted space.
>
> I would like this photograph kept for when they claim I raised them to scatter.

### One at a time, botanical27-05

- Original: `/tmp/botanical27/fws-common-seed.jpg`, 6016 x 4016, SHA1 `aec50bd3638ecf4244338472ee6aca4fdcd8c14f`. Courtney Celley/USFWS. Source: https://www.fws.gov/media/common-milkweed-gone-seed . Original URL: https://www.fws.gov/sites/default/files/2021-06/49018093678_8725de4bc8_o.jpg
- Delivery: `/tmp/freed-seed-delivery-33/silk.jpg`, 1300 x 868, 702,968 bytes, SHA1 `7e924d9885ef89e23272fe59cc8e716fbcbee4bd`.
- Delivery URL: https://www.fws.gov/sites/default/files/styles/max_1300x1300/public/2021-06/49018093678_8725de4bc8_o.jpg?itok=Hr0CRxL1
- PASS. The same central stem, open pods, loose white silk masses and brown seed points remain visible. The left foreground and right pods remain in frame. The caption depends on silk emerging in a mass, not proof of airborne seeds, and that event remains plainly illustrated.

Preserve exact prose:

> The pod opened. I had imagined a dignified departure, one seed at a time.
>
> Now the whole family is coming out in its underwear.

## Scope of approval

Approve these exact eleven delivery files for the existing bindings and existing crops. Preserve original catalog identities, attribution and prose. This review does not establish delivery latency, remote availability or quality at sizes larger than those inspected. Edmund medium is superseded by the hires SHA1 above.
