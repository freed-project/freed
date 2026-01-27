# FREED Marketing Site

Marketing website for FREED - Take Back Your Feed.

**Live at:** [freed.wtf](https://freed.wtf)

## Tech Stack

- **Framework:** Vite + React + TypeScript
- **Styling:** Tailwind CSS v4
- **Animations:** Framer Motion
- **Routing:** React Router DOM
- **Deployment:** GitHub Pages

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Deployment

The site auto-deploys to GitHub Pages on push to `main` via GitHub Actions.

To set up:
1. Go to repository Settings → Pages
2. Set Source to "GitHub Actions"
3. Push to main branch

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
