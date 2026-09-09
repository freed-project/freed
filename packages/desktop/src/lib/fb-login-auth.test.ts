import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it } from "vitest";

const script = readFileSync(resolve(process.cwd(), "src-tauri/src/fb-login-auth.js"), "utf8");

function loginDocument(url = "https://www.facebook.com/", failures = 0) {
  const timers: Array<() => void> = [];
  const events: unknown[] = [];
  let calls = 0;
  const document = {
    cookie: "",
    feed: false,
    querySelector: () => document.feed ? {} : null,
    querySelectorAll: () => [],
  };
  const window = {
    location: new URL(url),
    setTimeout(callback: () => void, delay: number) {
      expect(delay).toBe(500);
      timers.push(callback);
    },
    __TAURI__: { event: { emit(name: string, payload: unknown) {
      calls += 1;
      if (calls <= failures) return Promise.reject(new Error("IPC unavailable"));
      events.push({ name, payload });
      return Promise.resolve();
    } } },
  };
  const context = createContext({ window, document });
  const inject = () => runInContext(script, context);
  inject();
  return {
    document, window, events, timers, inject,
    calls: () => calls,
    async tick(count = 1) {
      for (let index = 0; index < count; index += 1) {
        timers.shift()?.();
        // Flush promises from both VM and host realms before the next timer.
        await setImmediate();
      }
    },
  };
}

describe("Facebook login completion", () => {
  it("waits for delayed session evidence and emits one privacy-scoped success", async () => {
    const page = loginDocument();
    await page.tick(8);
    expect(page.events).toEqual([]);
    page.document.cookie = "c_user=12345";
    await page.tick(5);
    page.inject();
    await page.tick(5);
    expect(page.events).toEqual([{ name: "fb-auth-result", payload: { loggedIn: true, source: "login_window" } }]);
    expect(page.timers).toHaveLength(0);
  });

  it("preserves rendered-feed evidence when session cookies are not script-readable", async () => {
    const page = loginDocument();
    page.document.feed = true;
    await page.tick();
    expect(page.events).toHaveLength(1);
  });

  it.each([
    "https://www.facebook.com/checkpoint/123",
    "https://www.facebook.com/login.php",
    "https://www.facebook.com/two_step_verification/",
    "https://www.facebook.com/recover/",
    "https://www.facebook.com/consent/",
    "https://facebook.com.example.org/",
    "http://www.facebook.com/",
  ])("does not declare a challenge or untrusted surface authenticated: %s", async (url) => {
    const page = loginDocument(url);
    page.document.cookie = "c_user=12345";
    page.document.feed = true;
    await page.tick(120);
    expect(page.events).toEqual([]);
    expect(page.timers).toHaveLength(0);
  });

  it("does not consume completion on rejected IPC and never retries indefinitely", async () => {
    const page = loginDocument(undefined, 2);
    page.document.cookie = "c_user=12345";
    await page.tick(5);
    expect(page.calls()).toBe(3);
    expect(page.events).toHaveLength(1);
    const denied = loginDocument(undefined, 200);
    denied.document.cookie = "c_user=12345";
    await denied.tick(121);
    expect(denied.calls()).toBe(120);
    expect(denied.timers).toHaveLength(0);
  });

  it("bounds logged-out checks and re-arms for a fresh reconnect document", async () => {
    const loggedOut = loginDocument();
    loggedOut.document.cookie = "c_user=0";
    await loggedOut.tick(120);
    expect(loggedOut.events).toEqual([]);
    expect(loggedOut.timers).toHaveLength(0);
    const reconnect = loginDocument();
    reconnect.document.cookie = "c_user=12345";
    await reconnect.tick();
    expect(reconnect.events).toHaveLength(1);
  });

  it("grants only event emission to the remote Facebook login window", () => {
    const capability = JSON.parse(readFileSync(resolve(process.cwd(), "src-tauri/capabilities/fb-login.json"), "utf8"));
    expect(capability.windows).toEqual(["fb-login"]);
    expect(capability.permissions).toEqual(["core:event:allow-emit"]);
    expect(capability.remote.urls).toEqual(["https://facebook.com/*", "https://*.facebook.com/*"]);
  });
});
