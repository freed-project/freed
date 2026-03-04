# Contributing to Freed

The platforms that hijacked your feed spent billions of dollars on it. This is the counter-move. It's built in public, by whoever shows up. If that's you, here's how to get started.

## Philosophy

Every contribution should make Freed more useful, more transparent, or more trustworthy. The guiding principles:

- **Privacy, always.** Never introduce telemetry or data collection.
- **Transparency.** Code should be readable. Complexity should be justified.
- **User control.** Features should give users more power, not less.
- **Simplicity.** Prefer the obvious solution over the clever one.

## Ways to Contribute

### Code

- Bug fixes
- New features (please open an issue first to discuss)
- Performance improvements
- Platform-specific capture improvements

### Design

- UI/UX improvements
- Illustrations and visual assets
- Accessibility improvements

### Documentation

- Improve existing docs
- Write tutorials
- Translations

### Testing

- Bug reports with reproduction steps
- Platform-specific testing (different browsers, OS versions)
- Selector maintenance for platform DOM changes

### Community

- Answer questions in issues
- Help newcomers
- Spread the word

## Getting Started

### Prerequisites

- Node.js 20+
- Bun (recommended) or npm
- Git

### Setup

```bash
# Clone the repo
git clone https://github.com/freed-project/freed.git
cd freed

# Install dependencies (website)
cd website
npm install

# Start dev server
npm run dev
```

### Project Structure

```
freed/
├── website/          # Marketing site
├── docs/             # Documentation
├── freed/            # Main monorepo (coming soon)
└── mobile/           # Tauri mobile (future)
```

## Submitting Changes

### Issues

- Search existing issues before opening a new one
- Use issue templates when available
- Provide as much context as possible

### Pull Requests

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Make your changes
4. Write/update tests if applicable
5. Ensure linting passes
6. Commit with clear messages following [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `perf:`, `style:`)
7. Push to your fork
8. Open a PR against `main`

**Merge policy:** All PRs are merged via **squash merge**. Your entire branch becomes a single commit on `main` — write your PR title and description accordingly, as the squash commit message is derived from them. Branches are deleted automatically after merge. Merge commits and rebase merges are disabled at the repository level.

### Commit Messages

Use clear, descriptive commit messages:

```
feat: add location extraction from Instagram stories
fix: handle missing author in Facebook posts
docs: update architecture diagram
refactor: simplify feed ranking algorithm
```

### Code Style

- TypeScript throughout
- Use Prettier for formatting
- Follow existing patterns in the codebase
- Comment complex logic

## Platform-Specific Contributions

### DOM Selectors

Platform DOMs change frequently. When updating selectors:

1. Document the change that broke the old selector
2. Test on multiple account types (if possible)
3. Include fallback selectors when reasonable
4. Add a comment with the date of the change

### New Platforms

Before adding a new platform:

1. Open an issue to discuss
2. Research the platform's DOM structure
3. Consider legal/ToS implications
4. Plan for stories/ephemeral content if applicable

## Code of Conduct

### Be Respectful

- Welcome newcomers
- Accept constructive criticism
- Focus on what's best for users
- Show empathy

### Be Professional

- No harassment or discrimination
- No trolling or personal attacks
- Keep discussions on-topic

### Be Collaborative

- Share knowledge freely
- Help others learn
- Credit contributors

## Questions?

- Open an issue for technical questions
- Check existing docs first
- Be patient — maintainers are volunteers

---

_The platforms become players in your game. Thanks for helping build the board._
