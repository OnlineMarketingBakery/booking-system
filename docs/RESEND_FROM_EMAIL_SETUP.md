# Use your own domain for Resend emails

Deployed Edge Functions **do not read your local `.env`**. They only use **Supabase secrets**. So you must set `RESEND_FROM_EMAIL` in Supabase for the "from" address to stop being `onboarding@resend.dev`.

## Option 1: Supabase Dashboard

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project.
2. Go to **Edge Functions** (left sidebar) → **Secrets** (or **Manage** → **Secrets**).
   - Direct link pattern: `https://supabase.com/dashboard/project/YOUR_PROJECT_REF/functions/secrets`
3. Add a secret:
   - **Key:** `RESEND_FROM_EMAIL`
   - **Value:** your sender address on your **verified** Resend domain, e.g. `noreply@booking.salonora.eu`
4. Save. **No redeploy needed** — Supabase injects secrets at runtime.

Optional: add `RESEND_FROM_NAME` = `Salonora` if you want to change the display name (default is already "Salonora").

## Option 2: Supabase CLI

From your project root:

```bash
supabase secrets set RESEND_FROM_EMAIL=noreply@booking.salonora.eu
```

Use the email address that belongs to a domain you’ve verified in the Resend dashboard.

## Verify

After setting the secret, trigger an email again (e.g. new sign-up or reject user). In Resend logs, the request body should show `"from": "Salonora <noreply@booking.salonora.eu>"` (or whatever you set) instead of `onboarding@resend.dev`.
