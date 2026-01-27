# Newsletter Setup TODOs

## Overview
The frontend integration is complete but disabled. The modal shows "COMING SOON" until Brevo is configured.

---

## Setup Steps

### 1. Brevo Account
- [ ] Create account at [brevo.com](https://www.brevo.com)
- [ ] Generate API key: Settings → SMTP & API → API Keys
- [ ] Create contact list: Contacts → Lists → "FREED Waitlist"
- [ ] Note the List ID (visible in URL when viewing list)
- [ ] Import 90k existing subscribers via CSV

### 2. Deploy Cloudflare Worker
```bash
cd workers/newsletter-subscribe
npm install -g wrangler
wrangler login
wrangler secret put BREVO_API_KEY   # paste your key when prompted
```
- [ ] Edit `wrangler.toml`: set `BREVO_LIST_ID` to your list ID
- [ ] Deploy: `wrangler deploy`
- [ ] Note the worker URL (e.g., `https://freed-newsletter.xxx.workers.dev`)

### 3. Configure GitHub Secrets
- [ ] Repo → Settings → Secrets → Actions
- [ ] Add `VITE_NEWSLETTER_API_URL` = your worker URL

### 4. Enable the Modal
- [ ] Remove disabled state from `website/src/components/NewsletterModal.tsx`
- [ ] Restore form submission logic (see git history or `workers/README.md`)

---

## Files Reference
| File | Purpose |
|------|---------|
| `workers/newsletter-subscribe/worker.js` | Cloudflare Worker (Brevo proxy) |
| `workers/newsletter-subscribe/wrangler.toml` | Worker config |
| `workers/README.md` | Detailed setup guide |
| `website/.env.example` | Environment variable template |
| `website/src/components/NewsletterModal.tsx` | Modal component (currently disabled) |

---

## Cost Summary
- **Brevo**: Free to store contacts, ~$10-25 per bulk send
- **Cloudflare Workers**: Free tier (100k requests/day)
- **Total monthly**: $0 until you send emails
