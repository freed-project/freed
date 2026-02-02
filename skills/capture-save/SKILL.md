---
name: capture-save
description: Save any URL to your FREED library
user-invocable: true
metadata: { "requires": { "bins": ["bun"] } }
---

# Save for Later

Capture any URL to your FREED library with full article extraction.

## Usage

- `capture-save add <url>` - Save a URL with full content extraction
- `capture-save add <url> --metadata-only` - Save metadata only (faster)
- `capture-save add <url> --tags "tag1,tag2"` - Save with tags
- `capture-save list` - List saved items
- `capture-save search <query>` - Search saved content

## What Gets Saved

- Page metadata (title, description, image)
- Full article content (reader view)
- Word count and reading time estimate

## Examples

```bash
# Save an article
capture-save add https://example.com/great-article

# Save with tags
capture-save add https://blog.example.com/post --tags "tech,programming"

# Quick save (metadata only)
capture-save add https://news.example.com/story --metadata-only
```
