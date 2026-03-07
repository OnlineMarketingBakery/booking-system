# Deploy Google Calendar functions

The "Requested function was not found" error when connecting Google Calendar means the **google-auth-callback** Edge Function (and related functions) are not deployed to your new Supabase project. Deploy them once.

---

## 1. Deploy the callback (required for "Connect Google Calendar")

From your project folder, with the project already linked:

```bash
cd G:\booking-new-module
npx supabase functions deploy google-auth-callback
```

---

## 2. Set Google OAuth secrets (required for the callback to work)

The callback needs your Google Cloud OAuth client ID and secret.

1. In [Google Cloud Console](https://console.cloud.google.com/) create (or use) an OAuth 2.0 Client ID (Application type: **Web application**).
2. Add this to **Authorized redirect URIs**:
   - `https://YOUR_PROJECT_REF.supabase.co/functions/v1/google-auth-callback`
   - Replace `YOUR_PROJECT_REF` with your Supabase project ref (e.g. `pgcvqaexvnwwskdhooly`).
3. Copy the **Client ID** and **Client secret**, then run:

```bash
npx supabase secrets set GOOGLE_CLIENT_ID="your-google-client-id"
npx supabase secrets set GOOGLE_CLIENT_SECRET="your-google-client-secret"
```

---

## 3. Deploy the other calendar functions (for sync and fetching events)

For full calendar sync and event fetching:

```bash
npx supabase functions deploy fetch-gcal-events
npx supabase functions deploy sync-booking-to-gcal
```

---

## 4. Try again

In your app, go to **Settings** (or **Calendar**) and click **Connect Google Calendar** again. The redirect should hit the deployed function and no longer return "function not found".
