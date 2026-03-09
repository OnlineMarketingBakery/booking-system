# Allow iframe embedding on Ploi (Hetzner)

Your app is hosted on **Hetzner** and managed with **Ploi**. To fix "Refused to display in a frame because it set 'X-Frame-Options' to 'sameorigin'", configure Nginx (and optionally Ploi) as below.

---

## If the whole site is currently embeddable (fix: only allow /book/)

If **every page** (dashboard, auth, etc.) can be put in an iframe, the header is applied **globally**. Do this:

1. **Remove** any `add_header Content-Security-Policy "frame-ancestors *"` from:
   - the main `server { }` block
   - the `location /` block  
   So it is **not** applied to the whole site.

2. **Add** the header **only** in a `location /book/` block (see section 1, Option A below).  
   Put the `location /book/` block **before** your `location /` block.

3. **Reload Nginx.**  
   Then only `https://boeking.salonora.eu/book/your-slug` should be embeddable; `/`, `/dashboard`, `/auth`, etc. should not.

---

## 1. Add headers in Ploi (Nginx)

1. In **Ploi**, open your server and select the **site** for `boeking.salonora.eu`.
2. Go to **Nginx** (or **Nginx Config** / **Edit Nginx configuration**).
3. Choose one of the following.

**Option A – Allow only the booking page (`/book/`) to be embedded (recommended)**

Add a `location` block for `/book/` and keep your existing `location /` for the rest of the app. Example:

```nginx
# Only /book/* can be embedded in iframes (booking widget).
location /book/ {
    try_files $uri $uri/ /index.html;
    add_header Content-Security-Policy "frame-ancestors *" always;
}

# Your existing location / block stays as-is (no frame-ancestors there).
```

If you already have a single `location /` that serves the SPA (e.g. `try_files $uri $uri/ /index.html`), you can add a **more specific** block for `/book/` **before** that block so Nginx uses it for `/book/*`:

```nginx
location /book/ {
    try_files $uri $uri/ /index.html;
    add_header Content-Security-Policy "frame-ancestors *" always;
}

location / {
    try_files $uri $uri/ /index.html;
    # no frame-ancestors here – dashboard/auth stay non-embeddable
}
```

**Option B – Allow the whole site to be embedded**

Add one line inside your existing `server` or `location /` block:

```nginx
add_header Content-Security-Policy "frame-ancestors *" always;
```

4. **Save** and **reload Nginx** (Ploi usually has a "Reload Nginx" button).

---

## 2. If X-Frame-Options is still set

Ploi or a security feature may add `X-Frame-Options: sameorigin`. When that header is present, the browser will still block the iframe.

**Option A – Disable in Ploi**

- In the site settings, look for **Security**, **Headers**, or **Hardening**.
- If you see an option related to **X-Frame-Options** or **clickjacking**, turn it off for this site.

**Option B – Override in Nginx**

Inside the same `server { ... }` block (or the same `location` where you added CSP), add:

```nginx
add_header X-Frame-Options "" always;
```

Some setups allow this to override a previously set value. If the header is still `sameorigin` in the browser, it is being set elsewhere (e.g. by another Nginx include or the app) and you’ll need to find and remove it there.

---

## 3. If /book/ is still blocked: move security headers into `location /` only

If `/book/` still can’t be embedded, the server-level `add_header` (e.g. `X-Frame-Options "SAMEORIGIN"`) may still be sent for every request. In that case, **don’t set those headers at server level**. Set them only in `location /` so they apply to the rest of the site, not to `/book/`.

**Before (server-level headers apply to all locations):**
```nginx
server {
    ...
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-XSS-Protection "1; mode=block";
    add_header X-Content-Type-Options "nosniff";
    ...
    location /book/ { ... }
    location / { ... }
}
```

**After (only `location /` gets the security headers; `/book/` does not):**
```nginx
server {
    ...
    charset utf-8;
    include /etc/nginx/ploi/boeking.salonora.eu/server/*;

    location /book/ {
        try_files $uri $uri/ /index.html;
        add_header Content-Security-Policy "frame-ancestors *" always;
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header X-Content-Type-Options "nosniff" always;
    }
}
```

So:
- **`/book/*`** → only `Content-Security-Policy: frame-ancestors *` (embeddable).
- **`/` and everything else** → `X-Frame-Options: SAMEORIGIN` plus the other headers (not embeddable).

Remove the three `add_header` lines from the **server** block and add them only inside **`location /`**. Then reload Nginx.

---

## 4. Check that it worked

1. Reload Nginx and clear cache (browser or CDN).
2. Open `https://boeking.salonora.eu/book/your-slug` in the browser.
3. Open **Developer Tools** → **Network** → select the request → **Headers** → **Response Headers**.
4. You should see **Content-Security-Policy: frame-ancestors ***. If **X-Frame-Options** is still `sameorigin`, follow step 2 above.

After that, the embed iframe on your test site should load.
