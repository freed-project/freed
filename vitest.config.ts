import { configDefaults, defineConfig } from "vitest/config";

// Workspace builds may emit test files beside production output. Running those
// copies makes counts depend on whether a build happened first, and a stale
// copy can report an obsolete test as green.
export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      "**/.next/**",
      "**/build/**",
      "**/coverage/**",
      "**/dist/**",
      "**/out/**",
      "**/target/**",
    ],
  },
});
