/**
 * Shared mock runtime for browser previews and headless Desktop tests.
 * Vite installs this before app modules; Playwright installs the same script
 * before navigation so tests can override handlers. No native build uses it.
 */
export declare function tauriInitScript(): string;
