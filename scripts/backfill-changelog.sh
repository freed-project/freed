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

def strip_prefix(msg):
    msg = re.sub(r" \(#\d+\)$", "", msg)
    msg = re.sub(r"^(feat|fix|perf|refactor|style|chore|docs|test|build|ci)(\([^)]+\))?!?: ", "", msg)
    return capitalize(msg.strip())

def fetch_summary(pr_num):
    body = gh_run(["pr", "view", str(pr_num), "--json", "body", "--jq", ".body"])
    lines, in_summary = [], False
    for line in body.split("\n"):
        if re.match(r"^## Summary", line):
            in_summary = True
            continue
        if in_summary and re.match(r"^## ", line):
            break
        if in_summary and line.strip():
            cleaned = re.sub(r"\*\*([^*]+)\*\*", r"\1", line)
            cleaned = re.sub(r"\*([^*]+)\*", r"\1", cleaned)
            cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
            cleaned = re.sub(r"^[-*] ", "", cleaned.strip())
            cleaned = re.sub(r":\s*$", "", cleaned)   # strip trailing colon
            lines.append(cleaned)
    return capitalize(lines[0]) if lines else ""

def build_body(tag, prev_tag):
    version = tag.lstrip("v")
    if prev_tag:
        commits = git(["log", f"{prev_tag}..{tag}", "--format=%s"]).splitlines()
    else:
        commits = git(["log", tag, "--format=%s"]).splitlines()

    feats, fixes, perfs = [], [], []
    for subj in commits:
        if not subj:
            continue
        if re.match(r"^(release:|chore:|docs:|test:|build:|ci:|Merge )", subj):
            continue

        pr_match = re.search(r"\(#(\d+)\)$", subj)
        pr_num = int(pr_match.group(1)) if pr_match else None

        if pr_num:
            summary = fetch_summary(pr_num)
            bullet = summary if summary and len(summary) <= 120 else strip_prefix(subj)
            link = f" ([#{pr_num}](https://github.com/freed-project/freed/pull/{pr_num}))"
        else:
            bullet = strip_prefix(subj)
            link = ""

        entry = f"- {bullet}{link}"
        if subj.startswith("feat"):
            feats.append(entry)
        elif subj.startswith("fix"):
            fixes.append(entry)
        elif subj.startswith("perf"):
            perfs.append(entry)

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

# Only tags that have a published GitHub Release
published = set(gh_run(["release", "list", "--limit", "200", "--json", "tagName",
                         "--jq", ".[].tagName"]).splitlines())

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
