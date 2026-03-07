# Embedding the booking widget in an iframe

The app provides an embed code (Dashboard → Embed) so other sites can show your booking page in an iframe. If you see:

**"Refused to display in a frame because it set 'X-Frame-Options' to 'sameorigin'"**

then the server hosting your app is blocking embedding. Fix it as follows.

---

## 1. Headers added in this project

Embedding is allowed **only for the booking page** (`/book/*`), not for the rest of the app (dashboard, auth, etc.).

- **`vercel.json`** – Sets `Content-Security-Policy: frame-ancestors *` for `/book/*` only (Vercel).
- **`netlify.toml`** – Same for **Netlify** (`/book/*` only).
- **`public/_headers`** – Same for hosts that use this file (`/book/*` only).

Redeploy after these files are in place so the new headers are active.

---

## 2. If the error persists: your host is setting X-Frame-Options

Some platforms add `X-Frame-Options: sameorigin` by default. You must **turn that off or allow framing** in the host’s settings; the app cannot override it from code alone.

- **Vercel** – Usually does not set X-Frame-Options; the `vercel.json` headers above are often enough.
- **Netlify** – Same; `netlify.toml` or `_headers` should be enough.
- **Cloudflare Pages** – In the dashboard, check **Settings → Rules** or **Transform Rules** for security headers and remove or change `X-Frame-Options`, or add a response header that sets `Content-Security-Policy: frame-ancestors *`.
- **Other hosts** – Look for “Security headers”, “Custom headers”, or “X-Frame-Options” and either disable X-Frame-Options or add `Content-Security-Policy: frame-ancestors *` (and ensure X-Frame-Options is not set to `sameorigin`).

---

## 3. Restricting which sites can embed (optional)

Only `/book/*` is allowed to be embedded. To also restrict **which sites** can embed it, replace `*` with their origins:

- **Vercel** (`vercel.json`):  
  `"value": "frame-ancestors 'self' https://client1.com https://www.client2.com"`
- **Netlify** (`netlify.toml`):  
  `Content-Security-Policy = "frame-ancestors 'self' https://client1.com https://www.client2.com"`

Then redeploy.
