import { createServer } from "node:net";
import { expect, it, vi } from "vitest";

it("keeps the scroll benchmark port stable in workers and preserves development coverage", async () => {
  const keys = ["PLAYWRIGHT_PORT", "PLAYWRIGHT_PERF_PORT", "BASE_URL", "PERF_BASE_URL"] as const;
  const saved = keys.map((key) => [key, process.env[key]] as const);
  keys.forEach((key) => { delete process.env[key]; });
  const server = createServer();
  // Load tooling through the test runner, without adding its JavaScript-only
  // helper graph to the application's TypeScript compilation unit.
  const configPath = "../playwright.config.ts";
  try {
    vi.resetModules();
    const { default: first } = await import(configPath);
    const perfPort = Number(process.env.PLAYWRIGHT_PERF_PORT);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(perfPort, "127.0.0.1", resolve);
    });
    vi.resetModules();
    const { default: worker } = await import(configPath);
    expect(worker.projects?.[1].use?.baseURL).toBe(first.projects?.[1].use?.baseURL);
    const ordinary = first.projects![0];
    const benchmark = first.projects![1];
    const scroll = "chromium perf-feed.spec.ts Scroll performance fast scroll through 3k items";
    const profiler = "chromium perf-feed.spec.ts React Profiler render cost";
    expect(scroll).toMatch(ordinary.grepInvert as RegExp);
    expect(scroll).toMatch(benchmark.grep as RegExp);
    expect(profiler).not.toMatch(ordinary.grepInvert as RegExp);
    expect(profiler).not.toMatch(benchmark.grep as RegExp);
    const servers = first.webServer as Array<{ command: string; env: Record<string, string> }>;
    expect(servers).toHaveLength(2);
    expect(servers.every((entry) => entry.command.includes("--config vite.config.ts"))).toBe(true);
    expect(servers[1].env).toMatchObject({ NODE_ENV: "production", VITE_TEST_TAURI: "1", FREED_E2E_PERF: "1" });
    expect(servers[0].env.NODE_ENV).toBe("development");
  } finally {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    saved.forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    vi.resetModules();
  }
});
