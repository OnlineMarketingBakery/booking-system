# Create Your First Super Admin

Your app uses **custom auth** (not Supabase Auth). You need:

1. The **`app_users`** table (for login).
2. At least one user with the **`super_admin`** role.

---

## Step 1: Add the `app_users` table (if needed)

If you only ran `database-export.sql`, the **`app_users`** table may be missing.

1. In Supabase: **SQL Editor** → **New query**.
2. Open **`supabase-add-app-users.sql`** in your project, copy all of it, paste into the editor, and click **Run**.

---

## Step 2: Deploy the auth Edge Function

Login/signup goes through the **auth-custom** Edge Function. Deploy it to your new project:

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) if you haven’t.
2. In a terminal, from your project folder:
   ```bash
   cd G:\booking-new-module
   npx supabase login
   npx supabase link --project-ref pcvqaexvnwwskdhooly
   ```
3. Set the JWT secret (used by auth-custom to sign tokens). In Supabase Dashboard: **Project Settings** → **API** → **JWT Settings** → copy the **JWT Secret**. Then:
   ```bash
   npx supabase secrets set JWT_SECRET="your-jwt-secret-here"
   ```
4. Deploy the function:
   ```bash
   npx supabase functions deploy auth-custom
   ```

---

## Step 3: Create the first super admin

Use **one** of these options.

### Option A: Sign up in the app, then make that user super admin (recommended)

1. Run your app: `npm run dev`.
2. Open the app and **Sign up** with the email and password you want for your super admin (e.g. your real email).
3. In Supabase: **Table Editor** → **`user_roles`**.
4. Click **Insert row** (or **Add row**).
5. Set:
   - **user_id**: the UUID of the user you just created (copy from **`app_users`** or **`profiles`** — same `id`).
   - **role**: `super_admin`
6. Save.

Next time you sign in with that user, they will have the super admin role.

### Option B: Use the seed function (test super admin)

If you deploy the **seed-test-data** Edge Function, it creates a test super admin:

- **Email:** `superadmin@glowbook.test`
- **Password:** `SuperAdmin123!`

1. Deploy the function:
   ```bash
   npx supabase functions deploy seed-test-data
   ```
2. Call it (no auth required; it uses the service role):
   - From the Supabase Dashboard: **Edge Functions** → **seed-test-data** → **Invoke**.
   - Or with curl (replace `YOUR_ANON_KEY` and project URL):
     ```bash
     curl -X POST "https://pcvqaexvnwwskdhooly.supabase.co/functions/v1/seed-test-data" -H "Authorization: Bearer YOUR_ANON_KEY" -H "Content-Type: application/json"
     ```
3. Sign in in the app with `superadmin@glowbook.test` / `SuperAdmin123!`.

---

## Summary

- Run **`supabase-add-app-users.sql`** in the SQL Editor if `app_users` is missing.
- Deploy **auth-custom** and set **JWT_SECRET** so login/signup work.
- Create the first super admin with **Option A** (sign up + add `super_admin` in `user_roles`) or **Option B** (invoke **seed-test-data** and use the test account).
