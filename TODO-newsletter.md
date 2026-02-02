# Newsletter Setup TODOs

## Overview

The frontend integration is complete. The modal submits to `/api/subscribe`, which is a Vercel Edge Function that proxies requests to Brevo.

---

## Setup Steps

### 1. Brevo Account

- [ ] Create account at [brevo.com](https://www.brevo.com)
- [ ] Generate API key: Settings → SMTP & API → API Keys
- [ ] Create contact list: Contacts → Lists → "FREED Waitlist"
- [ ] Note the List ID (visible in URL when viewing list)
- [ ] Import 90k existing subscribers via CSV

### 2. Deploy to Vercel

```bash
cd website
npm i -g vercel
vercel
```

- [ ] Link to your GitHub repo when prompted
- [ ] Enable automatic deployments from `main` branch

### 3. Configure Environment Variables

In the Vercel Dashboard (Project → Settings → Environment Variables):

- [ ] Add `BREVO_API_KEY` = your Brevo API key
- [ ] Add `BREVO_LIST_ID` = your list ID (number)

### 4. Configure Domain

In Vercel Dashboard (Project → Settings → Domains):

- [ ] Add `freed.wtf` as a custom domain
- [ ] Update DNS records as instructed
- [ ] Remove CNAME from GitHub Pages if still active

---

## Files Reference

| File                                         | Purpose                            |
| -------------------------------------------- | ---------------------------------- |
| `website/api/subscribe.ts`                   | Vercel Edge Function (Brevo proxy) |
| `website/vercel.json`                        | Vercel project configuration       |
| `website/src/components/NewsletterModal.tsx` | Modal component (functional)       |

---

## Local Development

The Edge Function requires Vercel's local dev server:

```bash
cd website
vercel dev
```

This runs the Vite dev server with Edge Functions available at `/api/*`.

Note: You'll need `BREVO_API_KEY` and `BREVO_LIST_ID` in your `.env.local` for local testing, or the function will return a 500 error.

---

## Cost Summary

- **Brevo**: Free to store contacts, ~$10-25 per bulk send
- **Vercel**: Free tier (Hobby plan for open source)
- **Total monthly**: $0

---

## Migration from Previous Setup

If you previously used Cloudflare Workers:

- The `workers/newsletter-subscribe/` directory can be removed
- GitHub secrets for `VITE_NEWSLETTER_API_URL` are no longer needed
- The API is now at `/api/subscribe` (relative path, same domain)
