# Step-by-Step: Connect Your Booking Project to Your New Supabase Account

This guide walks you through the Supabase "Create new project" form (from your screenshot) and then connecting your existing codebase to that new project.

---

## Part 1: Create the New Project in Supabase (From Your Screenshot)

### Step 1 – Organization
- The **Organization** dropdown should already show **"OnlineMarketingBakery's Org"** (FREE).
- Leave it as is unless you want a different organization.

### Step 2 – Project name
- **Project name** is already set to **"OnlineMarketingBakery's Project"** (or similar).
- You can keep it or change it (e.g. `booking-app`). The name will appear in the Supabase dashboard.

### Step 3 – Database password (required)
- This is the **Postgres database password** for your new project. The form will not let you continue without it.
- **Option A:** Click **"Generate a password."** Copy the generated password and **store it somewhere safe** (e.g. password manager). You’ll need it if you ever connect to the database directly (e.g. with a SQL client).
- **Option B:** Type your own **strong password** (mix of letters, numbers, symbols). Save it in a safe place.
- Enter the password in the **Database password** field until the red error **"Password is required."** disappears.

### Step 4 – Region
- **Region** is set to **Europe**. That’s fine for EU users.
- Change it only if your users are mainly in another region (e.g. US, Asia) for better performance.

### Step 5 – Security (recommended for your app)
- **Enable Data API** – Leave this **checked**. Your app uses `supabase-js`, which needs the auto-generated REST/API.
- **Enable automatic RLS** – Optional. You can leave it **unchecked** for now; your project already has RLS in migrations. You can enable it later if you want RLS on every new table by default.

### Step 6 – Create the project
- Click the green **"Create new project"** button.
- Wait 1–2 minutes until the project is fully provisioned (database + API).

---

## Part 2: Get Your New Project’s API Details

After the project is ready:

1. In the Supabase dashboard, open your new project (**OnlineMarketingBakery's Project** or whatever you named it).
2. Go to **Project Settings** (gear icon in the left sidebar).
3. Open the **API** section.
4. Copy and save:
   - **Project URL** (e.g. `https://xxxxxxxx.supabase.co`)
   - **anon public** key (under "Project API keys") — this is the key your frontend uses.

You’ll use these in Part 4.

---

## Part 3: Load Your Database Schema into the New Project

Your project has two ways to set up the database:

### Option A: Use the SQL Editor (simplest)

1. In the Supabase dashboard for your **new** project, go to **SQL Editor**.
2. Click **New query**.
3. Open the file **`database-export.sql`** from your project root in a text editor.
4. Copy its **entire contents** and paste into the SQL Editor.
5. Click **Run** (or press Ctrl+Enter).
6. Confirm there are no errors. Your tables, enums, and schema will be created.

### Option B: Use Supabase CLI and migrations

If you prefer to use the existing migration files:

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) if you haven’t.
2. In a terminal, go to your project folder:  
   `cd G:\booking-new-module`
3. Log in and link to your new project:
   - Run: `npx supabase login`
   - Then: `npx supabase link --project-ref YOUR_NEW_PROJECT_REF`  
     (Find **Project ref** in **Project Settings → General** in the dashboard.)
4. Push migrations:  
   `npx supabase db push`  
   This runs the SQL files in `supabase/migrations/` in order.

Use **either** Option A or Option B, not both (to avoid creating the same objects twice).

---

## Part 4: Point Your App to the New Supabase Project

Your app currently uses an old Supabase project (URL and key in `.env` and `src/integrations/supabase/client.ts`). To use the **new** project:

### 4.1 – Update `.env`

Edit the file **`.env`** in your project root. Replace the values with the ones from your **new** project (from Part 2):

```env
VITE_SUPABASE_PROJECT_ID=your_new_project_ref
VITE_SUPABASE_PUBLISHABLE_KEY=your_new_anon_public_key
VITE_SUPABASE_URL=https://your_new_project_ref.supabase.co
```

- **Project ref** is the part of the URL before `.supabase.co` (e.g. if URL is `https://abcdefgh.supabase.co`, the ref is `abcdefgh`).
- **Publishable key** is the **anon public** key from the API settings.

### 4.2 – Update the Supabase client (optional if you use .env)

Your app also has the URL and key hardcoded in **`src/integrations/supabase/client.ts`**. For consistency and to avoid maintaining two places:

- Either update that file with the new **Project URL** and **anon public** key,  
- Or change the file to read from `import.meta.env.VITE_SUPABASE_URL` and `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY` so a single `.env` controls everything.

After editing `.env` (and optionally `client.ts`), restart the dev server (`npm run dev` or `yarn dev`).

---

## Part 5: Verify

1. Run your app: `npm run dev` (or `yarn dev`).
2. Sign up / log in or use existing flows that touch the database.
3. In Supabase dashboard → **Table Editor**, confirm that your new project has the expected tables (e.g. `profiles`, `organizations`, `bookings`) and that data appears when you use the app.

---

## Quick Checklist

- [ ] Create new Supabase project (form from screenshot), including **Database password**.
- [ ] Copy **Project URL** and **anon public** key from **Settings → API**.
- [ ] Run **`database-export.sql`** in SQL Editor (or run migrations via CLI).
- [ ] Update **`.env`** with new `VITE_SUPABASE_*` values.
- [ ] Update **`src/integrations/supabase/client.ts`** with new URL and key (or switch it to use `.env`).
- [ ] Restart dev server and test the app.

If you tell me your new **Project URL** and **anon key** (you can redact part of the key if you prefer), I can show you the exact lines to put in `.env` and `client.ts` without changing any other part of your project.
