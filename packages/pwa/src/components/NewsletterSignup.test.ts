/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NewsletterSignup,
  type NewsletterSignupProps,
} from "../../../ui/src/components/NewsletterSignup";

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function findButton(
  container: HTMLElement,
  label: string,
): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(label),
  );
}

describe("NewsletterSignup", () => {
  beforeEach(() => {
    localStorage.clear();
    window.turnstile = {
      render: vi.fn((_container, options) => {
        options.callback?.("verified-token");
        return "newsletter-widget";
      }),
      reset: vi.fn(),
      remove: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.turnstile;
  });

  it("collects email and name, verifies the visitor, and confirms signup inline", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement<NewsletterSignupProps>(NewsletterSignup, {
          siteKey: "public-site-key",
        }),
      );
    });

    const email = container.querySelector<HTMLInputElement>(
      'input[type="email"]',
    )!;
    const name = container.querySelector<HTMLInputElement>(
      'input[autocomplete="name"]',
    )!;
    expect(name).not.toBeNull();
    expect(window.turnstile?.render).not.toHaveBeenCalled();
    await act(async () => findButton(container, "Join the newsletter")?.click());
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(email.getAttribute("aria-describedby")!)?.textContent).toBe("Enter a valid email address.");
    expect(window.turnstile?.render).not.toHaveBeenCalled();
    await act(async () => {
      setInput(email, "reader@example.com");
      setInput(name, "Reader Name");
    });
    expect(window.turnstile?.render).not.toHaveBeenCalled();
    await act(async () => {
      findButton(container, "Join the newsletter")?.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.turnstile?.render).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ appearance: "interaction-only", action: "newsletter_signup" }));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://www.freed.wtf/api/subscribe",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      email: "reader@example.com",
      name: "Reader Name",
      company: "",
      turnstileToken: "verified-token",
    });
    expect(container.textContent).toContain("You’re on the list.");
    expect(localStorage.getItem("freed-newsletter-subscribed-v1")).toBe("1");

    await act(async () => root.unmount());
    container.remove();
  });

  it("waits for verification and cancels queued signup when details change", async () => {
    let verify: ((token: string) => void) | undefined;
    window.turnstile!.render = vi.fn((_container, options) => {
      verify = options.callback;
      return "newsletter-widget";
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(NewsletterSignup)));
    const email = container.querySelector<HTMLInputElement>('input[type="email"]')!;
    await act(async () => {
      setInput(email, "reader@example.com");
      setInput(container.querySelector<HTMLInputElement>('input[autocomplete="name"]')!, "Reader");
    });
    await act(async () => findButton(container, "Join the newsletter")?.click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Your signup will continue automatically");
    await act(async () => setInput(email, "changed@example.com"));
    await act(async () => verify?.("verified-token"));
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => findButton(container, "Join the newsletter")?.click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).email).toBe("changed@example.com");
    await act(async () => root.unmount());
    container.remove();
  });

  it("completes the local preview without sending or storing a subscription", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement<NewsletterSignupProps>(NewsletterSignup, {
          previewOnly: true,
        }),
      );
    });

    await act(async () => {
      setInput(
        container.querySelector<HTMLInputElement>('input[type="email"]')!,
        "reader@example.com",
      );
      setInput(
        container.querySelector<HTMLInputElement>(
          'input[autocomplete="name"]',
        )!,
        "Reader Name",
      );
    });
    await act(async () => {
      findButton(container, "Join the newsletter")?.click();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("freed-newsletter-subscribed-v1")).toBeNull();
    expect(container.textContent).toContain("That’s the complete signup flow.");

    await act(async () => root.unmount());
    container.remove();
  });

  it("matches marketing name suggestions without overwriting a manual edit or clearing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement<NewsletterSignupProps>(NewsletterSignup, { compact: true })));
    const email = container.querySelector<HTMLInputElement>('input[type="email"]')!;
    const name = container.querySelector<HTMLInputElement>('input[autocomplete="name"]')!;
    for (const [address, suggestion] of [
      ["ada.lovelace42+news@example.com", "Ada Lovelace"],
      ["GRACE_HOPPER-test@example.com", "Grace Hopper Test"],
      ["123+news@example.com", ""],
    ]) {
      await act(async () => setInput(email, address));
      expect(name.value).toBe(suggestion);
    }
    expect(window.turnstile?.render).not.toHaveBeenCalled();
    await act(async () => setInput(name, "Dr. My Own Name"));
    await act(async () => setInput(email, "different.person@example.com"));
    expect(name.value).toBe("Dr. My Own Name");
    await act(async () => setInput(name, ""));
    await act(async () => setInput(email, "another.person@example.com"));
    expect(name.value).toBe("");
    await act(async () => findButton(container, "Join the newsletter")?.click());
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Keep up with Freed.");
    await act(async () => root.unmount());
    container.remove();
  });
});
