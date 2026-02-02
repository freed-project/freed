# FREED Workers (Deprecated)

> **Note:** This directory is deprecated. Newsletter subscriptions now use Vercel Edge Functions.
> See `website/api/subscribe.ts` and `TODO-newsletter.md` for the current setup.

---

## Legacy: Cloudflare Workers

Serverless functions for the FREED website.

## Newsletter Subscription Worker

Proxies newsletter signups to Brevo (formerly Sendinblue), keeping API keys secure.

### Setup

1. **Create a Brevo Account**
   - Sign up at [brevo.com](https://www.brevo.com)
   - Get your API key from Settings → SMTP & API → API Keys

2. **Create a Contact List**
   - Go to Contacts → Lists → Add a list
   - Name it (e.g., "FREED Waitlist")
   - Note the List ID (visible in the URL or list settings)

3. **Import Your Existing 90k Subscribers**
   - Go to Contacts → Import contacts
   - Upload CSV with email column
   - Map to your list
   - Brevo handles deduplication automatically

4. **Deploy the Worker**

   ```bash
   cd workers/newsletter-subscribe

   # Install wrangler if you haven't
   npm install -g wrangler

   # Login to Cloudflare
   wrangler login

   # Set your API key as a secret (won't be visible in code)
   wrangler secret put BREVO_API_KEY
   # Paste your Brevo API key when prompted

   # Deploy
   wrangler deploy
   ```

5. **Update wrangler.toml**
   - Set `BREVO_LIST_ID` to your list's ID
   - Set `ALLOWED_ORIGIN` to your domain

6. **Configure GitHub Secrets**
   - Go to your repo → Settings → Secrets → Actions
   - Add `VITE_NEWSLETTER_API_URL` with your worker URL
     (e.g., `https://freed-newsletter.your-subdomain.workers.dev`)

### Local Development

Create `website/.env` (git-ignored):

```
VITE_NEWSLETTER_API_URL=https://freed-newsletter.your-subdomain.workers.dev
```

Without this variable set, the modal will simulate success (useful for UI development).

### Cost Breakdown

- **Cloudflare Workers**: Free tier = 100k requests/day (more than enough)
- **Brevo**:
  - Free to store unlimited contacts
  - Pay per email sent (~$25 for 90k emails)
  - No monthly subscriber fees like Mailchimp

### Testing the Worker

```bash
curl -X POST https://your-worker.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

Should return:

```json
{ "success": true, "message": "Successfully subscribed" }
```
