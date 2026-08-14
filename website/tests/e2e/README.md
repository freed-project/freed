# Website browser tests

Run these tests from `website/`:

```bash
npm run test:e2e
```

## Theme selector contract

The footer selector previews themes on hover. A preview can change fonts, line
metrics, and total page height. The interactive selector must therefore move to
a fixed layer captured before the preview is applied. An inline-only selector
can move out from under the pointer and enter a preview and revert loop.

The visible grid has three columns in this order:

1. Ember, Midas, Scriptorium
2. Starship, Dark Star, Neon

Both rows reserve enough height for the active theme. The active swatch remains
taller than resting themes, but changing the active row cannot move either row.
The browser test checks the real pointer target and geometry across animation
frames because DOM presence or a static CSS assertion cannot detect this bug.
