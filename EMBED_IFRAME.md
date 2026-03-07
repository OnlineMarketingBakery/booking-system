# Embedding the booking widget in an iframe

The app provides an embed code (Dashboard → Embed) so other sites can show your booking page in an iframe. If you see:

**"Refused to display in a frame because it set 'X-Frame-Options' to 'sameorigin'"**

then the server hosting your app is blocking embedding. Fix it as follows.

---

## 1. Headers added in this project

- **`vercel.json`** – Sets `Content-Security-Policy: frame-ancestors *` for all routes (Vercel). Path-only rules often don’t apply on SPAs, so the header is applied site-wide.
- **`netlify.toml`** – Same idea for **Netlify** (currently scoped to `/book/*`).
- **`public/_headers`** – For hosts that use this file.

Redeploy after these files are in place so the new headers are active.

---

## 2. If the error persists: your host is setting X-Frame-Options

If you **redeployed** and the iframe is still blocked, the host is probably sending **`X-Frame-Options: sameorigin`** itself. When that header is present, browsers block embedding even if we send `Content-Security-Policy: frame-ancestors *`. You have to **turn off or change that header in the host’s dashboard** (the app cannot remove it from code).

- **Vercel** – Project → **Settings** → **Security** (or **Headers**). If you see “X-Frame-Options” or “Clickjacking protection”, disable it or allow framing.
- **Netlify** – **Site settings** → **Build & deploy** → **Post processing** → **Security headers** – disable “X-Frame-Options” or set a custom header that allows framing.
- **Cloudflare** – **Rules** → **Transform Rules** → **Modify Response Header** – delete the `X-Frame-Options` header for your domain, or add a rule that sets it only for paths you don’t want embedded.
- **Other hosts** – Look for “Security headers”, “Custom headers”, or “Clickjacking / X-Frame-Options” and disable or override it for your site.

---

## 3. Restricting which sites can embed (optional)

Only `/book/*` is allowed to be embedded. To also restrict **which sites** can embed it, replace `*` with their origins:

- **Vercel** (`vercel.json`):  
  `"value": "frame-ancestors 'self' https://client1.com https://www.client2.com"`
- **Netlify** (`netlify.toml`):  
  `Content-Security-Policy = "frame-ancestors 'self' https://client1.com https://www.client2.com"`

Then redeploy.
