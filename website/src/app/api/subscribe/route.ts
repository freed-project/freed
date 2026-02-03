/**
 * Next.js Route Handler: Newsletter Subscription
 *
 * Proxies newsletter signups to Brevo's API, keeping the API key server-side.
 *
 * Environment Variables (set in Vercel Dashboard):
 *   BREVO_API_KEY  - Your Brevo API key
 *   BREVO_LIST_ID  - Your contact list ID
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

interface SubscribeRequest {
  email: string;
}

interface BrevoError {
  code?: string;
  message?: string;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: NextRequest) {
  try {
    const { email } = (await request.json()) as SubscribeRequest;

    // Validate email
    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
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

    // Add contact to Brevo
    const brevoResponse = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        email: email,
        listIds: [parseInt(listId)],
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
    const brevoError = (await brevoResponse
      .json()
      .catch(() => ({}))) as BrevoError;

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
