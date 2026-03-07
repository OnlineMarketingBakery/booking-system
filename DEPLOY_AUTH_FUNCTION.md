# Deploy auth-custom so Sign up / Sign in work

The **404** and **CORS** errors on sign up happen because the **auth-custom** Edge Function is not deployed to your Supabase project. Deploy it once, then sign up will work.

---

## 1. Install Supabase CLI (if needed)

- **Windows (PowerShell):**  
  `irm https://github.com/supabase/cli/releases/latest/download/supabase_windows_amd64.exe -OutFile supabase.exe`
- Or use npm: `npm install -g supabase`

---

## 2. Log in and link your project

In a terminal, from your project folder:

```bash
cd G:\booking-new-module
npx supabase login
```

Then link this repo to your Supabase project (use the **Reference ID** from Supabase Dashboard → Project Settings → General):

```bash
npx supabase link --project-ref pgcvqaexvnwwskdhooly
```

If your project ref is different, use that instead of `pgcvqaexvnwwskdhooly`.

---

## 3. Set the JWT secret (required for auth-custom)

The function signs tokens with your project’s JWT secret.

1. In [Supabase Dashboard](https://supabase.com/dashboard) → your project → **Project Settings** (gear) → **API**.
2. Under **JWT Settings**, copy the **JWT Secret**.
3. In the terminal:

```bash
npx supabase secrets set JWT_SECRET="paste-your-jwt-secret-here"
```

---

## 4. Deploy the auth-custom function

```bash
npx supabase functions deploy auth-custom
```

Wait until you see a success message.

---

## 5. Try sign up again

1. Restart your app if it’s running (`npm run dev`).
2. Open the app and use **Sign up** again.

The request should go to `https://pgcvqaexvnwwskdhooly.supabase.co/functions/v1/auth-custom` (or your project URL) and the function will respond. The 404 and CORS errors should be gone.

---

## If you still get 404

- Confirm **Project ref** in **Settings → General** matches the ref in your `.env` (`VITE_SUPABASE_PROJECT_ID`). The ref is the part of the URL before `.supabase.co` (e.g. `pgcvqaexvnwwskdhooly`).
- If the ref in `.env` was wrong, fix it, then restart the dev server and try again.
