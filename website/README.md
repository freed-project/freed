# Freed Marketing Site

Marketing website for Freed.

**Live at:** [freed.wtf](https://freed.wtf)
**Dev branch site:** `dev.freed.wtf`

## Tech Stack

- **Framework:** Next.js App Router + TypeScript
- **Styling:** Tailwind CSS v4
- **Animations:** Framer Motion
- **Deployment:** Vercel

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Run production locally
npm run start
```

## Deployment

The site uses a dev-first branch flow:

- `dev` is the default integration branch and deploys to `dev.freed.wtf`
- `main` is the production promotion branch and deploys to `freed.wtf`

## Design System

### Colors

- **Background:** `#0a0a0a` (freed-black)
- **Glow Blue:** `#3b82f6`
- **Glow Purple:** `#8b5cf6`
- **Glow Cyan:** `#06b6d4`

### Components

- `.glass-card` - Glassmorphic cards with blur backdrop
- `.gradient-text` - Gradient text effect
- `.glow-sm/md/lg` - Glow shadow effects
- `.btn-primary` - Primary gradient button
- `.btn-secondary` - Secondary outline button

## License

MIT
