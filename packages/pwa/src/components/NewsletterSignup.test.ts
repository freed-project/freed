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
          endpoint: "https://freed.wtf/api/subscribe",
          siteKey: "public-site-key",
        }),
      );
    });

    const email = container.querySelector<HTMLInputElement>(
      'input[type="email"]',
    )!;
    await act(async () => {
      setInput(email, "reader@example.com");
      findButton(container, "Join the newsletter")?.click();
    });

    const name = container.querySelector<HTMLInputElement>(
      'input[autocomplete="name"]',
    )!;
    expect(name).not.toBeNull();
    await act(async () => {
      setInput(name, "Reader Name");
    });
    await act(async () => {
      findButton(container, "Join the newsletter")?.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
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
      findButton(container, "Join the newsletter")?.click();
    });
    await act(async () => {
      setInput(
        container.querySelector<HTMLInputElement>(
          'input[autocomplete="name"]',
        )!,
        "Reader Name",
      );
      findButton(container, "Join the newsletter")?.click();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("freed-newsletter-subscribed-v1")).toBeNull();
    expect(container.textContent).toContain("That’s the complete signup flow.");

    await act(async () => root.unmount());
    container.remove();
  });
});
