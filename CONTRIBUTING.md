# Contributing to Freed

First off, thank you for considering contributing to Freed. It's people like you who will help make mental sovereignty a reality for millions.

## Philosophy

Freed exists to restore human autonomy in the attention economy. Every contribution should further this mission. We value:

- **Privacy above all** — Never introduce telemetry or data collection
- **Transparency** — Code should be readable and well-documented
- **User empowerment** — Features should give users more control, not less
- **Simplicity** — Prefer simple solutions over clever ones

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
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Write/update tests if applicable
5. Ensure linting passes
6. Commit with clear messages
7. Push to your fork
8. Open a PR against `main`

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

_Thank you for helping build a freer internet._
