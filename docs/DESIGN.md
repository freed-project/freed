# FREED Design System

## Philosophy

FREED's visual identity embodies **digital liberation**. The design language is dark, sophisticated, and subtly rebellious—premium enough to be taken seriously, edgy enough to signal we're building something different.

**Reference Sites:**
- Linear.app (clean, professional, dark)
- getmaestro.ai (data visualization, modern)
- Arc Browser (color energy, playfulness)

**Our Addition:** Blue/purple glowmorphism over deep black. The glow represents freedom, consciousness, the spark of autonomy returning to the user.

---

## Color Palette

### Base Colors

| Name | Hex | Usage |
|------|-----|-------|
| freed-black | `#0a0a0a` | Primary background |
| freed-dark | `#0f0f0f` | Secondary background |
| freed-surface | `#141414` | Cards, elevated surfaces |
| freed-border | `rgba(255,255,255,0.08)` | Subtle borders |

### Glow Colors

| Name | Hex | Usage |
|------|-----|-------|
| glow-blue | `#3b82f6` | Primary accent |
| glow-purple | `#8b5cf6` | Secondary accent |
| glow-cyan | `#06b6d4` | Tertiary accent |

### Text Colors

| Name | Hex | Usage |
|------|-----|-------|
| text-primary | `#fafafa` | Headlines, important text |
| text-secondary | `#a1a1aa` | Body text, descriptions |
| text-muted | `#71717a` | Captions, metadata |

---

## Typography

### Font Family
**Inter** — Clean, modern, excellent readability

```css
font-family: 'Inter', system-ui, -apple-system, sans-serif;
```

### Scale

| Element | Size | Weight |
|---------|------|--------|
| H1 (Hero) | 4.5rem - 5rem | 700 |
| H2 (Section) | 2.5rem - 3rem | 700 |
| H3 (Card) | 1.25rem | 600 |
| Body | 1rem - 1.125rem | 400 |
| Caption | 0.875rem | 400-500 |

### Gradient Text

```css
.gradient-text {
  background: linear-gradient(135deg, #3b82f6, #8b5cf6, #06b6d4);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

---

## Effects

### Glow Shadows

```css
/* Small glow */
.glow-sm {
  box-shadow: 
    0 0 10px rgba(139, 92, 246, 0.2),
    0 0 20px rgba(59, 130, 246, 0.1);
}

/* Medium glow */
.glow-md {
  box-shadow: 
    0 0 20px rgba(139, 92, 246, 0.3),
    0 0 40px rgba(59, 130, 246, 0.15),
    0 0 60px rgba(139, 92, 246, 0.05);
}

/* Large glow */
.glow-lg {
  box-shadow: 
    0 0 30px rgba(139, 92, 246, 0.4),
    0 0 60px rgba(59, 130, 246, 0.2),
    0 0 100px rgba(139, 92, 246, 0.1);
}
```

### Glassmorphism

```css
.glass-card {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
}

.glass-card:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(139, 92, 246, 0.3);
}
```

### Gradient Border

```css
.gradient-border {
  position: relative;
  background: #141414;
  border-radius: 16px;
}

.gradient-border::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 17px;
  background: linear-gradient(135deg, #3b82f6, #8b5cf6, #06b6d4);
  z-index: -1;
  opacity: 0.5;
}
```

### Noise Texture

Subtle noise overlay adds tactile quality:

```css
.noise-overlay {
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,..."); /* SVG noise filter */
  opacity: 0.03;
  pointer-events: none;
}
```

---

## Components

### Buttons

#### Primary Button
Gradient background with glow shadow.

```css
.btn-primary {
  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
  color: white;
  font-weight: 600;
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  box-shadow: 0 0 20px rgba(139, 92, 246, 0.3);
  transition: all 0.2s ease;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 0 30px rgba(139, 92, 246, 0.5);
}
```

#### Secondary Button
Transparent with border.

```css
.btn-secondary {
  background: transparent;
  color: #fafafa;
  font-weight: 600;
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: all 0.2s ease;
}

.btn-secondary:hover {
  border-color: #8b5cf6;
  background: rgba(139, 92, 246, 0.1);
}
```

### Cards

Feature cards use glassmorphism with glow on hover:

```jsx
<div className="glass-card p-6 transition-all duration-300 hover:glow-sm">
  <div className="text-4xl mb-4">🔒</div>
  <h3 className="text-xl font-semibold text-text-primary mb-2">
    Local-First Privacy
  </h3>
  <p className="text-text-secondary">
    All your data stays on your device.
  </p>
</div>
```

### Navigation

Fixed nav with backdrop blur:

```jsx
<nav className="fixed top-0 left-0 right-0 z-50 px-6 py-4">
  <div className="max-w-6xl mx-auto flex items-center justify-between">
    {/* Logo + Links + CTA */}
  </div>
</nav>
```

---

## Animations

Using Framer Motion for all animations.

### Fade In Up

```jsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.6 }}
>
```

### Stagger Children

```jsx
{items.map((item, index) => (
  <motion.div
    key={item.id}
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true }}
    transition={{ duration: 0.5, delay: index * 0.1 }}
  >
```

### Pulse Glow

```jsx
<motion.div
  animate={{ 
    boxShadow: [
      '0 0 30px rgba(139, 92, 246, 0.3)',
      '0 0 60px rgba(139, 92, 246, 0.5)',
      '0 0 30px rgba(139, 92, 246, 0.3)',
    ]
  }}
  transition={{ duration: 2, repeat: Infinity }}
>
```

### Button Interaction

```jsx
<motion.button
  whileHover={{ scale: 1.02 }}
  whileTap={{ scale: 0.98 }}
>
```

---

## Layout

### Max Width
Content constrained to `max-w-6xl` (72rem / 1152px)

### Spacing
- Section padding: `py-24 px-6`
- Card padding: `p-6`
- Gap between cards: `gap-6`

### Grid
- Features: 3 columns on desktop, 2 on tablet, 1 on mobile
- How It Works: 4 columns on desktop

```jsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
```

---

## Illustrations

### Style
Abstract geometric shapes representing:
- **Connection** — Lines, nodes, networks
- **Liberation** — Breaking free, expanding outward
- **Convergence** — Multiple sources flowing to one

### Hero Animation
- Platform icons (X, Facebook, Instagram) orbit a central FREED node
- Data particles flow inward
- Pulse rings emanate from center
- Gradient glow orbs in background

### Implementation
SVG + CSS animations via Framer Motion. No external assets required.

---

## Responsive Breakpoints

| Breakpoint | Width | Usage |
|------------|-------|-------|
| sm | 640px | Mobile landscape |
| md | 768px | Tablet |
| lg | 1024px | Desktop |
| xl | 1280px | Large desktop |

---

## Dark Mode

FREED is dark-only. No light mode toggle.

The dark theme is integral to the brand—it represents:
- Privacy (nothing to hide, but nothing exposed)
- Focus (reduced visual noise)
- Rebellion (against the bright, attention-grabbing platforms)

---

## Accessibility

- Sufficient color contrast (text on dark backgrounds)
- Focus states on interactive elements
- Semantic HTML structure
- Keyboard navigation support
- Motion respects `prefers-reduced-motion`
