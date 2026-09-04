# Visual Contracts

- Inspect the nearest mature product surface and shared theme primitives before changing UI. Match the established tokens, radius, density, typography, borders, shadows, states, responsive behavior, and every active theme.
- Search the package for an existing component, hook, or style before creating one. Extract a shared primitive when multiple surfaces need the same behavior.
- Use the established primary and secondary control hierarchy. Do not add glossy or gradient utility controls, or hover effects that lift, bounce, or move a button vertically.
- Map every new right-edge toolbar control into an existing overflow section or a new named section. Keep it reachable at every supported width. Collapsed form controls and tooltip or trigger wrappers must fill the menu content width.
- Add focused e2e coverage for both inline and overflow states when a shared toolbar contract changes. Assert menu-section width for collapsed form controls.
- Keep floating menus inside the viewport and internally scrollable. Use `theme-menu-shell` with its top or max-height variable instead of raw `overflow-hidden`. Add focused coverage when content can exceed the viewport.
