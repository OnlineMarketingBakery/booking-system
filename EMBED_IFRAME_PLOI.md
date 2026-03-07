# Allow iframe embedding on Ploi (Hetzner)

Your app is hosted on **Hetzner** and managed with **Ploi**. To fix "Refused to display in a frame because it set 'X-Frame-Options' to 'sameorigin'", configure Nginx (and optionally Ploi) as below.

---

## 1. Add headers in Ploi (Nginx)

1. In **Ploi**, open your server and select the **site** for `booking.onlinemarketingbakery.nl`.
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

## 3. Check that it worked

1. Reload Nginx and clear any cache (browser or CDN).
2. Open `https://booking.onlinemarketingbakery.nl/book/your-slug` in the browser.
3. Open **Developer Tools** → **Network** → select the request → **Headers** → **Response Headers**.
4. You should see **Content-Security-Policy: frame-ancestors ***. If **X-Frame-Options** is still `sameorigin`, follow step 2 above.

After that, the embed iframe on your test site should load.
