# Domain change: booking.onlinemarketingbakery.nl → booking.salonora.eu

Code and docs have been updated to use **https://booking.salonora.eu**. Complete these steps so nothing breaks.

---

## 1. Supabase Edge Function Secrets

In **Supabase Dashboard** → **Edge Functions** → **Secrets**, set or update:

| Secret | Value |
|--------|--------|
| `APP_URL` | `https://booking.salonora.eu` |
| `RESEND_FROM_EMAIL` | Your sender address on a **verified** Resend domain (e.g. `noreply@booking.salonora.eu`). Required so emails can be sent to external recipients instead of using the test domain `onboarding@resend.dev`. |

This is used for:
- Stripe success/cancel redirects after payment (`create-booking-checkout`)
- Google Calendar OAuth redirect back to your app (`google-auth-callback`)
- Sign-up notification and approval emails (dashboard link in emails)

---

## 2. Google Cloud OAuth (if you use Google Calendar)

1. **Google Cloud Console** → **APIs & Services** → **Credentials** → your OAuth 2.0 client.
2. **Authorized redirect URIs**:  
   - Remove `https://booking.onlinemarketingbakery.nl/auth/google-callback` if present.  
   - Add: `https://booking.salonora.eu/auth/google-callback`
3. **Authorized JavaScript origins** (if set):  
   - Replace any `https://booking.onlinemarketingbakery.nl` with `https://booking.salonora.eu`
4. In Supabase, set the redirect URI (or do it via Secrets):
   ```bash
   npx supabase secrets set GOOGLE_OAUTH_REDIRECT_URI="https://booking.salonora.eu/auth/google-callback"
   ```
5. Redeploy the callback so it picks up the secret:
   ```bash
   npx supabase functions deploy google-auth-callback
   ```

---

## 3. Server / hosting (Ploi, Nginx, DNS)

1. **DNS**  
   Point `booking.salonora.eu` to your server (A or CNAME as you had for the old domain).

2. **Ploi**  
   - Add a new site for `booking.salonora.eu` (or reconfigure the existing one if you’re replacing the old domain).  
   - Point the site’s document root to the same app as before (or your new build).  
   - If you use SSL, request/install a certificate for `booking.salonora.eu`.

3. **Nginx**  
   - If you followed `EMBED_IFRAME_PLOI.md`, update any paths that still reference `booking.onlinemarketingbakery.nl` to `booking.salonora.eu` (e.g. `include /etc/nginx/ploi/booking.salonora.eu/server/*;`).  
   - Reload Nginx after changes.

4. **Build & deploy**  
   Build the app and deploy the output to the server that serves `https://booking.salonora.eu`.

---

## 4. What was changed in the repo

- **`.env`** – Added `APP_URL=https://booking.salonora.eu` (Supabase still needs this in Secrets).
- **`EMBED_IFRAME_PLOI.md`** – All `booking.onlinemarketingbakery.nl` → `booking.salonora.eu`.
- **`DEPLOY_GOOGLE_CALENDAR.md`** – Same domain replacement in examples.
- **`OnboardingWizard.tsx`** – Placeholder text `yourapp.com/book/` → `booking.salonora.eu/book/`.

App logic uses `window.location.origin` (e.g. embed URL) or `APP_URL` from Supabase, so no further code changes are required for the domain switch once the steps above are done.
