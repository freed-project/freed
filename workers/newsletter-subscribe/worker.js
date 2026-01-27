/**
 * Cloudflare Worker: Brevo Newsletter Subscription Proxy
 * 
 * This worker securely handles newsletter subscriptions by proxying requests
 * to Brevo's API, keeping your API key server-side.
 * 
 * SETUP:
 * 1. Create a Cloudflare account at https://dash.cloudflare.com
 * 2. Go to Workers & Pages → Create Application → Create Worker
 * 3. Paste this code and deploy
 * 4. Go to Settings → Variables → Add:
 *    - BREVO_API_KEY: Your Brevo API key (from https://app.brevo.com/settings/keys/api)
 *    - BREVO_LIST_ID: Your contact list ID (number)
 *    - ALLOWED_ORIGIN: Your website URL (e.g., https://freed.sh)
 * 5. Copy the worker URL and set it as VITE_NEWSLETTER_API_URL in your .env
 */

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(env.ALLOWED_ORIGIN),
      });
    }

    // Only allow POST
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, env.ALLOWED_ORIGIN);
    }

    try {
      const { email } = await request.json();

      // Validate email
      if (!email || !isValidEmail(email)) {
        return jsonResponse({ error: 'Invalid email address' }, 400, env.ALLOWED_ORIGIN);
      }

      // Check for required env vars
      if (!env.BREVO_API_KEY || !env.BREVO_LIST_ID) {
        console.error('Missing BREVO_API_KEY or BREVO_LIST_ID environment variables');
        return jsonResponse({ error: 'Server configuration error' }, 500, env.ALLOWED_ORIGIN);
      }

      // Add contact to Brevo
      const brevoResponse = await fetch('https://api.brevo.com/v3/contacts', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'api-key': env.BREVO_API_KEY,
        },
        body: JSON.stringify({
          email: email,
          listIds: [parseInt(env.BREVO_LIST_ID)],
          updateEnabled: true, // Update if contact already exists
        }),
      });

      // Handle Brevo response
      if (brevoResponse.ok) {
        return jsonResponse({ success: true, message: 'Successfully subscribed' }, 200, env.ALLOWED_ORIGIN);
      }

      // Handle specific Brevo errors
      const brevoError = await brevoResponse.json().catch(() => ({}));
      
      // Contact already exists (not really an error for our use case)
      if (brevoError.code === 'duplicate_parameter') {
        return jsonResponse({ success: true, message: 'Already subscribed' }, 200, env.ALLOWED_ORIGIN);
      }

      console.error('Brevo API error:', brevoError);
      return jsonResponse({ error: 'Subscription failed' }, 500, env.ALLOWED_ORIGIN);

    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ error: 'Internal server error' }, 500, env.ALLOWED_ORIGIN);
    }
  },
};

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
