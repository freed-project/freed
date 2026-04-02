#!/usr/bin/env bash
# backfill-changelog.sh
#
# One-time script to populate GitHub Release bodies for all existing tags.
# Uses git log between consecutive tags to find conventional commits, then
# fetches PR bodies via gh to extract rich summaries.
#
# Usage:
#   bash scripts/backfill-changelog.sh            # write to GitHub
#   bash scripts/backfill-changelog.sh --dry-run  # preview only
#
# Requires: git, gh (authenticated), python3

set -euo pipefail

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

# Verify gh is authenticated
gh auth status 2>&1 | grep -q "Logged in" || {
  echo "ERROR: not logged into gh. Run: gh auth login"
  exit 1
}

python3 - "$DRY_RUN" <<'PYEOF'
import subprocess, re, sys, time

DRY_RUN = sys.argv[1] == "true"

def git(cmd):
    return subprocess.check_output(["git"] + cmd, text=True).strip()

def gh_run(cmd):
    r = subprocess.run(["gh"] + cmd, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""

def capitalize(s):
    return s[:1].upper() + s[1:] if s else s

def normalize_body_text(body):
    return body.replace("\\r\\n", "\n").replace("\\n", "\n")

def normalize_subject(msg):
    return re.sub(r"^(?:\[[^\]]+\]\s*)+", "", msg).strip()

def commit_kind(msg):
    normalized = normalize_subject(msg)
    match = re.match(r"^(feat|fix|perf|refactor|style|chore|docs|test|build|ci)(\([^)]+\))?!?:", normalized)
    return match.group(1) if match else ""

def strip_prefix(msg):
    msg = normalize_subject(msg)
    msg = re.sub(r" \(#\d+\)$", "", msg)
    msg = re.sub(r"^(feat|fix|perf|refactor|style|chore|docs|test|build|ci)(\([^)]+\))?!?: ", "", msg)
    return capitalize(msg.strip())

def clean_detail_line(line):
    cleaned = re.sub(r"\*\*([^*]+)\*\*", r"\1", line)
    cleaned = re.sub(r"\*([^*]+)\*", r"\1", cleaned)
    cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
    cleaned = re.sub(r"^[-*] ", "", cleaned.strip())
    cleaned = re.sub(r":\s*$", "", cleaned)
    return capitalize(cleaned.strip())

def extract_section(body, headings):
    lines = normalize_body_text(body).split("\n")
    in_section = False
    section_lines = []
    for line in lines:
        heading = line.strip().lower()
        if heading in headings:
            in_section = True
            continue
        if in_section and re.match(r"^##\s+", line):
            break
        if in_section:
            section_lines.append(line.rstrip())
    return section_lines

def parse_details(lines):
    details = []
    paragraph = []
    skip_values = {"Includes", "Include", "Summary", "What changed", "Impact"}

    def flush_paragraph():
        nonlocal paragraph
        if not paragraph:
            return
        text = clean_detail_line(" ".join(paragraph))
        if text and text not in skip_values:
            details.append(text)
        paragraph = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            flush_paragraph()
            continue
        if stripped.startswith("```"):
            flush_paragraph()
            continue
        if re.match(r"^[-*] ", stripped):
            flush_paragraph()
            text = clean_detail_line(stripped)
            if text:
                details.append(text)
            continue
        if stripped.startswith("(AI Generated"):
            continue
        paragraph.append(stripped)

    flush_paragraph()
    seen = set()
    unique = []
    for detail in details:
        if detail not in seen:
            seen.add(detail)
            unique.append(detail)
    return unique

def fetch_details(pr_num):
    body = gh_run(["pr", "view", str(pr_num), "--json", "body", "--jq", ".body"])
    preferred_sections = [
        {"## what changed"},
        {"## summary"},
        {"## impact"},
    ]

    for headings in preferred_sections:
        details = parse_details(extract_section(body, headings))
        if details:
            return details

    return parse_details(normalize_body_text(body).split("\n"))

def build_body(tag, prev_tag):
    if prev_tag:
        commits = git(["log", f"{prev_tag}..{tag}", "--format=%s"]).splitlines()
    else:
        commits = git(["log", tag, "--format=%s"]).splitlines()

    feats, fixes, perfs = [], [], []
    for subj in commits:
        if not subj:
            continue
        normalized_subj = normalize_subject(subj)
        kind = commit_kind(subj)
        if re.match(r"^(release:|docs:|test:|build:|ci:|Merge )", normalized_subj):
            continue

        pr_match = re.search(r"\(#(\d+)\)$", subj)
        pr_num = int(pr_match.group(1)) if pr_match else None

        if pr_num:
            details = fetch_details(pr_num)
            if details:
                entries = [
                    f"- {detail} ([#{pr_num}](https://github.com/freed-project/freed/pull/{pr_num}))"
                    for detail in details
                ]
            else:
                entries = [
                    f"- {strip_prefix(subj)} ([#{pr_num}](https://github.com/freed-project/freed/pull/{pr_num}))"
                ]
        else:
            entries = [f"- {strip_prefix(subj)}"]

        if kind == "feat":
            feats.extend(entries)
        elif kind == "perf":
            perfs.extend(entries)
        else:
            fixes.extend(entries)

    lines = [f"## Freed {tag}", ""]
    if feats:
        lines += ["### What's New", ""] + feats + [""]
    if perfs:
        lines += ["### Performance", ""] + perfs + [""]
    if fixes:
        lines += ["### Fixes", ""] + fixes + [""]
    if not feats and not fixes and not perfs:
        lines += ["### Fixes", "", "- Bug fixes and improvements", ""]

    lines += [
        "### Downloads",
        "",
        "**macOS:** `.dmg` (Apple Silicon or Intel)  ",
        "**Windows:** `.exe` (NSIS installer)  ",
        "**Linux:** `.AppImage`  ",
        "",
        "> macOS users may need to right-click → Open on first launch.",
    ]
    return "\n".join(lines)

# All v* tags in version order
all_tags = [t for t in git(["tag", "--sort=version:refname"]).splitlines() if t.startswith("v")]

# Only tags with a fully published (non-draft, non-prerelease) GitHub Release.
# Draft releases are failed builds that never shipped to users -- they must not
# be used as changelog boundaries or their features will be silently swallowed.
published = set(gh_run([
    "release", "list", "--limit", "200",
    "--json", "tagName,isDraft,isPrerelease",
    "--jq", '.[] | select(.isDraft==false and .isPrerelease==false) | .tagName',
]).splitlines())

print(f"Found {len(all_tags)} tags, {len(published)} with GitHub Releases.\n")

# We track the last *published* tag, not the last tag. This is the key: when a
# build fails and leaves an unpublished tag, the next successful release should
# span all the way back to the last good published release so that features
# developed during the failed build attempts are not silently dropped.
prev_published_tag = ""
processed = 0
for tag in all_tags:
    if tag not in published:
        print(f"⚠  {tag} — no GitHub Release, skipping")
        # Do NOT advance prev_published_tag here — that's the whole fix.
        continue

    print(f"Processing {tag} (prev: {prev_published_tag or 'none'})...", end=" ", flush=True)
    body = build_body(tag, prev_published_tag)

    if DRY_RUN:
        print("DRY RUN")
        print(f"{'─'*60}")
        print(body)
        print(f"{'─'*60}\n")
    else:
        proc = subprocess.run(
            ["gh", "release", "edit", tag, "--notes-file", "-"],
            input=body,
            capture_output=True,
            text=True,
        )
        if proc.returncode == 0:
            print("✓")
        else:
            print(f"✗  {proc.stderr.strip()}")
        time.sleep(0.5)   # be kind to the API

    prev_published_tag = tag
    processed += 1

print(f"\nDone. {processed} releases {'previewed' if DRY_RUN else 'updated'}.")
PYEOF
