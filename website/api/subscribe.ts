/**
 * Vercel Edge Function: Newsletter Subscription
 *
 * Proxies newsletter signups to Brevo's API, keeping the API key server-side.
 *
 * Environment Variables (set in Vercel Dashboard):
 *   BREVO_API_KEY  - Your Brevo API key
 *   BREVO_LIST_ID  - Your contact list ID
 */

export const config = {
  runtime: "edge",
};

interface SubscribeRequest {
  email: string;
}

interface BrevoError {
  code?: string;
  message?: string;
}

export default async function handler(request: Request): Promise<Response> {
  // Only allow POST
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { email } = (await request.json()) as SubscribeRequest;

    // Validate email
    if (!email || !isValidEmail(email)) {
      return new Response(JSON.stringify({ error: "Invalid email address" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check for required env vars
    const apiKey = process.env.BREVO_API_KEY;
    const listId = process.env.BREVO_LIST_ID;

    if (!apiKey || !listId) {
      console.error(
        "Missing BREVO_API_KEY or BREVO_LIST_ID environment variables",
      );
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
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
      return new Response(
        JSON.stringify({ success: true, message: "Successfully subscribed" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Handle specific Brevo errors
    const brevoError = (await brevoResponse
      .json()
      .catch(() => ({}))) as BrevoError;

    // Contact already exists (not really an error for our use case)
    if (brevoError.code === "duplicate_parameter") {
      return new Response(
        JSON.stringify({ success: true, message: "Already subscribed" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    console.error("Brevo API error:", brevoError);
    return new Response(JSON.stringify({ error: "Subscription failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
