/**
 * Next.js Route Handler: Newsletter Subscription
 *
 * Proxies newsletter signups to Brevo's API, keeping the API key server-side.
 *
 * Environment Variables (set in Vercel Dashboard):
 *   BREVO_API_KEY  - Your Brevo API key
 *   BREVO_LIST_ID  - Your contact list ID
 *   TURNSTILE_SECRET_KEY - Cloudflare Turnstile secret key
 */

import { NextRequest, NextResponse } from "next/server";

const BREVO_CONTACTS_ENDPOINT = "https://api.brevo.com/v3/contacts";
const TURNSTILE_VERIFY_ENDPOINT =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 6;
const EMAIL_COOLDOWN_MS = 60 * 1000;

const requestBuckets = new Map<string, { count: number; resetAt: number }>();
const recentEmailSubmissions = new Map<string, number>();

interface SubscribeRequest {
  email: string;
  name?: string;
  phoneNumber?: string;
  company?: string;
  turnstileToken?: string;
}

interface BrevoError {
  code?: string;
  message?: string;
}

interface TurnstileVerificationResponse {
  success: boolean;
  hostname?: string;
  "error-codes"?: string[];
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizePhoneNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const hasLeadingPlus = trimmed.startsWith("+");
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (!digitsOnly) return "";

  if (hasLeadingPlus) {
    return `+${digitsOnly}`;
  }

  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`;
  }

  if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
    return `+${digitsOnly}`;
  }

  return `+${digitsOnly}`;
}

function isValidPhoneNumber(value: string): boolean {
  if (!value.trim()) return true;
  const normalized = normalizePhoneNumber(value);
  const digits = normalized.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function getRequestIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = requestBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    requestBuckets.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return false;
  }

  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

function isEmailCoolingDown(email: string): boolean {
  const now = Date.now();
  const lastAttempt = recentEmailSubmissions.get(email) ?? 0;
  recentEmailSubmissions.set(email, now);
  return now - lastAttempt < EMAIL_COOLDOWN_MS;
}

async function verifyTurnstileToken(
  token: string,
  request: NextRequest,
): Promise<TurnstileVerificationResponse> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;

  if (!secretKey) {
    console.error("Missing TURNSTILE_SECRET_KEY environment variable");
    return {
      success: false,
      "error-codes": ["missing-input-secret"],
    };
  }

  const body = new URLSearchParams({
    secret: secretKey,
    response: token,
  });

  const remoteIp = getRequestIp(request);
  if (remoteIp !== "unknown") {
    body.set("remoteip", remoteIp);
  }

  const response = await fetch(TURNSTILE_VERIFY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  return (await response.json()) as TurnstileVerificationResponse;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as SubscribeRequest | null;

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const normalizedEmail = (body.email ?? "").trim().toLowerCase();
    const normalizedName = (body.name ?? "").trim();
    const normalizedPhoneNumber = normalizePhoneNumber(body.phoneNumber ?? "");
    const turnstileToken = (body.turnstileToken ?? "").trim();
    const honeypotValue = (body.company ?? "").trim();

    if (honeypotValue) {
      return NextResponse.json({
        success: true,
        message: "Successfully subscribed",
      });
    }

    // Validate email
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
      );
    }

    if (!normalizedName) {
      return NextResponse.json(
        { error: "Please tell us your name." },
        { status: 400 }
      );
    }

    if (!isValidPhoneNumber(body.phoneNumber ?? "")) {
      return NextResponse.json(
        { error: "Please enter a valid phone number or leave it blank." },
        { status: 400 }
      );
    }

    if (!turnstileToken) {
      return NextResponse.json(
        { error: "Please complete the human check and try again." },
        { status: 400 }
      );
    }

    const requestIp = getRequestIp(request);

    if (isRateLimited(`newsletter:${requestIp}`)) {
      return NextResponse.json(
        { error: "Too many signup attempts. Please wait a minute and try again." },
        { status: 429 }
      );
    }

    const turnstileResult = await verifyTurnstileToken(turnstileToken, request);

    if (!turnstileResult.success) {
      const errorCodes = turnstileResult["error-codes"] ?? [];
      const isExpired = errorCodes.includes("timeout-or-duplicate");

      return NextResponse.json(
        {
          error: isExpired
            ? "That human check expired. Please try again."
            : "We could not verify the human check. Please try again.",
        },
        { status: 400 }
      );
    }

    if (isEmailCoolingDown(normalizedEmail)) {
      return NextResponse.json(
        { error: "Too many signup attempts. Please wait a minute and try again." },
        { status: 429 }
      );
    }

    // Check for required env vars
    const apiKey = process.env.BREVO_API_KEY;
    const listId = process.env.BREVO_LIST_ID;

    if (!apiKey || !listId) {
      console.error(
        "Missing BREVO_API_KEY or BREVO_LIST_ID environment variables"
      );
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    const parsedListId = Number.parseInt(listId, 10);

    if (!Number.isFinite(parsedListId) || parsedListId <= 0) {
      console.error("Invalid BREVO_LIST_ID environment variable");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    // Add contact to Brevo
    const brevoResponse = await fetch(BREVO_CONTACTS_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        email: normalizedEmail,
        listIds: [parsedListId],
        attributes: {
          FIRSTNAME: normalizedName,
          ...(normalizedPhoneNumber ? { SMS: normalizedPhoneNumber } : {}),
        },
        updateEnabled: true, // Update if contact already exists
      }),
    });

    // Handle Brevo response
    if (brevoResponse.ok) {
      return NextResponse.json({
        success: true,
        message: "Successfully subscribed",
      });
    }

    // Handle specific Brevo errors
    const brevoError = (await brevoResponse.json().catch(() => ({}))) as BrevoError;

    // Contact already exists (not really an error for our use case)
    if (brevoError.code === "duplicate_parameter") {
      return NextResponse.json({
        success: true,
        message: "Already subscribed",
      });
    }

    console.error("Brevo API error:", brevoError);
    return NextResponse.json({ error: "Subscription failed" }, { status: 500 });
  } catch (error) {
    console.error("Route handler error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
