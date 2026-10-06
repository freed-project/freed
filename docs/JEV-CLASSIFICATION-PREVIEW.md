# Jev evaluation in Freed Desktop

Open **Settings → AI → Post classification** and choose a classifier.
For Jev API, enter your own TypeSafe API key and choose **Save**. Local Kev
requires no key; follow [Local Kev](#local-kev) below.
The native client stores the Jev key in the operating system credential vault on supported
macOS and Windows builds. Replace or remove it from the same section. The key
never enters the repository, Library records, synchronization, or diagnostics.

**Test connection** sends a short synthetic post through the pinned Jev model.
It does not send Library content and may incur API usage. Saving a key does not
contact Jev. Jev operates independently of the summary provider and local AI packs.

## Classify Library posts

Expand **Jev classification** and choose **Load Library posts**. Native evaluation
reads up to 100 visible social posts and stories, taking a bounded window from
each supported social source. It uses the existing SQLite feed and ranged body
queries, reads at most 32,004 source bytes per post, and sends at most 8,000 text
characters plus a bounded title. It does not fetch additional content from social
providers. Images, audio, and video are not analyzed.

Choose **Classify Library posts** to load and send the current bounded window to Jev. The panel
shows all 26 independent scores beside the local rules, plus returned token usage,
elapsed time, and estimated cost. Native requests go directly to TypeSafe through
the application, with four concurrent requests, a 30-second deadline, bounded
request and response bodies, and no automatic retries. Cancellation stops queued
work and cancels active native requests. Already processed calls may still incur
charges that are absent from the returned usage.

This dev slice evaluates results inside the Jev view. It does not replace durable
feed classifications, event candidates, or filter membership. Closing settings
clears results. Library changes invalidate the evaluated window. Automatic
background classification, durable jobs, and persistent results remain unfinished.
A future write integration needs complete event metadata and a native source fence;
compact feed cards are insufficient for safe replacement writes.

The base 20 signals retain the existing classifier contract. Help offered,
Collaboration, Work in progress, Appreciation, Humor & play, and Correction remain
separate experimental scores until their quality is evaluated.

## Optional local GLiClass Base

Choose **GLiClass Base v3.0 · local CPU** in the classifier selector. Selection
downloads the official weights and tokenizer from Hugging Face, about 755 MB.
Progress, cancellation with retained partial files, resume, integrity checks,
and model removal use the existing local model downloader. The selector is
separate from summary-provider preferences. Model files and selection stay on
this device. Jev remains available through an explicit switch.

The download pins `knowledgator/gliclass-base-v3.0` at
`77a70e6cd52e602ed18184ef37d18bdd3741e3d5`. A 1.3 MB bundled full-logits ONNX graph
references exact byte ranges in the official safetensors file. Its provenance
and Apache-2.0 notice live in `packages/desktop/src-tauri/models/gliclass-base/`.
The application uses native ONNX Runtime and a native tokenizer; Python is used
only for reproducible conversion tooling. No third-party model artifact enters
the automatic download chain.

Inference runs off the UI thread, with one resident session, one inference thread,
one post at a time and a 30-second deadline. Cancellation terminates active
inference and drains it before another request. Idle residency expires after
60 seconds. There are 26 Freed signals and a 25-class checkpoint bound, so a post
uses two serial forward passes. Inputs above 512 tokens abstain without silently
truncating source text or labels. Local failures never fall back to a cloud call.

A bounded cache holds up to 512 score results for this application session.
SHA-256 keys include source evidence, checkpoint, actual label schema,
preprocessing and scoring version. Unchanged evidence skips new inference;
changed evidence or schema produces a new key. Counters record cache hits,
misses, inference calls and abstentions without source text. The cache is not a
persistent background classification index. This MVP evaluates a bounded Library
window and leaves durable classifications untouched.

The local label hypotheses and 0.5 signal threshold are experimental. Synthetic
output comparisons verify runtime conversion, not accuracy parity with Jev.
Capability matching remains available only through an explicit switch to Jev.

## People I can help and Make something together

Enter one to eight skills, one per line. An explicit matching run sends those
skills and bounded post text to Jev. Names, relationship records, contacts, and
private relationship notes remain local. Matching evaluates explicit help requests
and collaboration invitations separately against each declared skill.

Results require both intent and skill probabilities of at least 0.7. This is a
provisional threshold, not measured accuracy. The view shows source text and the
matching skills, with age, Friend, and dismissal controls. Existing exact
Account-to-Person links supply relationship context; unresolved identities remain
**Relationship unknown**. Profile and source changes invalidate old matches.
Recency does not establish that a request is still open. Check the original post
before acting. Freed does not contact anyone or change relationship records.

**Preview example matches** uses fictional people and authored scores. It sends
no API requests and makes no Library writes. It demonstrates the interface only.

## Browser preview

Run the repository preview helper with the pinned Node toolchain:

```sh
./scripts/worktree-preview.sh desktop --port 1423
```

Use the same **Settings → AI → Post classification** controls. Browser preview credentials stay
in tab memory and disappear on reload. Each explicit request passes the key
through the private development server without saving it. There are no environment
or host-file credential fallbacks. Do not expose this development server publicly.

The browser Library is synthetic. Its comparison controls can apply the original
20 signals to the sample feed through the existing analysis mutation, preserving
sample event metadata. Native evaluation remains read-only. The browser transport
accepts only tagged sample records, validates the exact origin, isolates cached
responses by credential, permits at most four active requests, and caps upstream
attempts at 2,000 per server process. It retries overload once within the same
30-second deadline. Cached responses incur no new inference request.

## Validation limits

Deterministic tests cover question construction, strict response parsing, bounded
requests, cancellation, credential locality, and profile/source freshness. Browser
checks use explicit test responses. They do not establish live Jev compatibility,
accuracy, actual charges, native credential-vault access, or installed-build behavior.
Enter a personal key in the installed client to evaluate those properties.

## Local Kev

Select **Kev · local service** in Settings → AI → Post classification. This is
optional and per-device. Jev keys and spending limits remain independent. Kev
never falls back to Jev, even when unavailable or uncertain.

Install Git and [uv](https://docs.astral.sh/uv/getting-started/installation/), then
start the pinned service in Terminal:

```sh
git clone --branch kev-1.0 https://github.com/jaredpalmer/kev.git
cd kev
uv sync --extra serve
uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b@v1.0 --host 127.0.0.1 --port 8009
```

The initial setup downloads Python dependencies and model weights. Kev uses MLX
on supported Apple Silicon hardware. Start with 4B; model installation and process
lifetime are separate from Freed. Keep `KEV_API_KEY` unset and truncation disabled.
Stop with Control-C to release model memory. Freed connects only to the literal
loopback address above and disables HTTP proxies and redirects. It does not manage
the service or authenticate other local processes.

Click **Check local Kev**, then expand the classification view to load and classify
up to 100 local posts. Images are not analyzed. Probabilities from 0.2 through 0.8
are provisional decision boundaries: values strictly between them abstain; values
at or outside them are accepted. Raw scores remain visible. Overlong source text
and server-truncated responses abstain. Scores never update durable Library data.
Capability matching still requires an explicit switch to Jev.

### Labeled comparison

**Run labeled evaluation** sends six synthetic examples with the same 26 questions
to the selected model. Twenty-four explicit labels cover positive, negative and
instruction-injection cases. Missing labels are not treated as negative. Run Kev,
then select Jev and repeat to compare the two reports in the same Settings session.
The Jev run uses the existing key and spending admission and can incur six API
requests. Kev uses neither credentials nor the Jev budget. No Library content is
used by this evaluation.

Raw accuracy thresholds probabilities at 0.5. Brier score measures squared
probability error. Kev decision coverage excludes its abstentions; accepted
accuracy uses only accepted labels. Jev retains its existing 0.5 decision threshold.
The report also shows median and maximum end-to-end latency and estimated API cost.
Cancellation or failure produces no new aggregate. Previous completed reports stay
visible until Settings closes. These examples are a smoke test, not evidence of
quality on your feed; inspect real posts and flagged errors before tuning thresholds.
