# Migration checklist – moved to your own accounts

Use this to confirm everything is on **your** Supabase and Google (and Stripe, if you use it), not the old personal/Lovable setup.

---

## Code/config updated (no action needed)

- **`.env`** – Uses your Supabase project (`pgcvqaexvnwwskdhooly`), URL, and anon key.
- **`src/integrations/supabase/client.ts`** – Same project URL and key; old commented key removed.
- **`src/contexts/AuthContext.tsx`** – Fallback project ID set to your project (used if `.env` is missing).
- **`supabase/config.toml`** – `project_id` set to your project (for CLI `link`/deploy).
- **Redirects** – `google-auth-callback` and `create-booking-checkout` default to `http://localhost:8080` and use `APP_URL` when set.

---

## Supabase (your project)

- [ ] **Database** – Schema applied (`database-export.sql` + `supabase-add-app-users.sql` if needed).
- [ ] **Edge Functions deployed** – At least: `auth-custom`, `google-auth-callback`, and any others you use (e.g. `create-booking-checkout`, `verify-booking-payment`, `fetch-gcal-events`, `sync-booking-to-gcal`).
- [ ] **Secrets set** – `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Optionally `APP_URL` for production.

---

## Google Cloud (Booking System project)

- [ ] **OAuth consent screen** – Configured with your app name (e.g. “Booking System”) and support email.
- [ ] **OAuth client** – Web application with redirect URI to your Supabase function and JS origin(s) (e.g. `http://localhost:8080`).
- [ ] **Calendar API** – Enabled in the same project.
- [ ] **Old “Booking Module” client** – Removed from the n8n project if you created a separate Booking System project.

---

## Stripe (if you use payments)

- [ ] **Stripe account** – Use your own Stripe account, not a shared/test one.
- [ ] **Supabase secret** – `STRIPE_SECRET_KEY` set for your project (`npx supabase secrets set STRIPE_SECRET_KEY="sk_..."`).
- [ ] **Stripe Connect** – If orgs have `stripe_account_id`, those Connect accounts must be in your Stripe dashboard.

---

## Production (when you deploy the frontend)

- [ ] **`APP_URL`** – Set in Supabase to your live app URL (e.g. `https://your-domain.com`) so redirects (Google Calendar, Stripe success/cancel) go to your site.
- [ ] **Google OAuth** – Add your production URL to Authorized JavaScript origins (and redirect URI if you add a production callback path).
- [ ] **Env vars** – Production build uses your Supabase URL and anon key (e.g. same as `.env` or your hosting’s env).

---

## Optional cleanup

- **README.md** – Still mentions Lovable; you can replace with your own repo/deploy docs.
- **`lovable-tagger`** in `vite.config.ts` / `package.json` – Dev dependency only; safe to keep or remove.

You’re fully migrated when: the app runs against your Supabase project, auth and Google Calendar use your Booking System OAuth client, and (if applicable) payments use your Stripe keys and Connect accounts.
