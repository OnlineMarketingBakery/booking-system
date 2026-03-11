# Exact setup: run these in order

Use either **Option A** (Supabase CLI) or **Option B** (Supabase Dashboard SQL Editor).

---

## Option A: Supabase CLI (one-time setup)

### 1. Link project (if not already linked)

```bash
cd G:\booking-new-module
npx supabase link --project-ref YOUR_PROJECT_REF
```

Get `YOUR_PROJECT_REF` from Supabase Dashboard → Project Settings → General → Reference ID.

### 2. Run all pending migrations

```bash
npx supabase db push
```

### 3. Deploy the reminder cron function

```bash
npx supabase functions deploy send-booking-reminders --no-verify-jwt
```

### 4. Set secrets (Dashboard or CLI)

In **Supabase Dashboard** → Project Settings → Edge Functions → add/verify:

- `RESEND_API_KEY` – your Resend API key (same as for booking emails)
- `RESEND_FROM_EMAIL` – sender email (e.g. `noreply@yourdomain.com`)
- `CRON_SECRET` (optional) – random string; if set, cron must send header `x-cron-secret: <value>`

Or via CLI:

```bash
npx supabase secrets set RESEND_API_KEY=re_xxxx
npx supabase secrets set RESEND_FROM_EMAIL=noreply@yourdomain.com
npx supabase secrets set CRON_SECRET=your-random-secret
```

### 5. Call the reminder function every hour (cron)

Use an external cron (e.g. cron-job.org, GitHub Actions) or Supabase cron if enabled.

**Example (run every hour):**

```bash
curl -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-booking-reminders" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "x-cron-secret: your-random-secret"
```

Replace `YOUR_PROJECT_REF`, `YOUR_ANON_KEY`, and `your-random-secret` (if you set `CRON_SECRET`). If you did not set `CRON_SECRET`, omit the `x-cron-secret` header.

---

## Option B: Supabase Dashboard (SQL only)

Run these in **Supabase Dashboard** → **SQL Editor**, in order. Execute each block as a single run.

---

### SQL 1: VAT rates table and services link

Run this first.

```sql
-- VAT/BTW rates per organization (user-defined)
CREATE TABLE public.vat_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  percentage NUMERIC(5,2),
  is_default BOOLEAN NOT NULL DEFAULT false,
  percentage_disabled BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vat_rates_org ON public.vat_rates(organization_id);

ALTER TABLE public.vat_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org owners can manage vat_rates"
  ON public.vat_rates FOR ALL
  USING (organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()));
CREATE POLICY "Public can view vat_rates for active orgs"
  ON public.vat_rates FOR SELECT
  USING (true);

CREATE TRIGGER update_vat_rates_updated_at
  BEFORE UPDATE ON public.vat_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS vat_rate_id UUID REFERENCES public.vat_rates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_services_vat_rate ON public.services(vat_rate_id);
```

---

### SQL 2: Default VAT rates (trigger + backfill)

Run after SQL 1.

```sql
CREATE OR REPLACE FUNCTION public.insert_default_vat_rates_for_org(_org_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.vat_rates (organization_id, name, percentage, is_default, percentage_disabled, sort_order)
  VALUES
    (_org_id, 'VAT high', 21, true, false, 0),
    (_org_id, 'VAT low', 9, false, false, 1),
    (_org_id, 'VAT free', 0, false, false, 2),
    (_org_id, 'VAT exempt', NULL, false, true, 3);
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_insert_default_vat_rates_on_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.insert_default_vat_rates_for_org(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_organization_created_insert_default_vat_rates ON public.organizations;
CREATE TRIGGER on_organization_created_insert_default_vat_rates
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_insert_default_vat_rates_on_org();

INSERT INTO public.vat_rates (organization_id, name, percentage, is_default, percentage_disabled, sort_order)
SELECT o.id, v.name, v.percentage, v.is_default, v.percentage_disabled, v.sort_order
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('VAT high'::text, 21::numeric, true, false, 0),
    ('VAT low', 9, false, false, 1),
    ('VAT free', 0, false, false, 2),
    ('VAT exempt', NULL::numeric, false, true, 3)
) AS v(name, percentage, is_default, percentage_disabled, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.vat_rates vr WHERE vr.organization_id = o.id);
```

---

### SQL 3: Booking reminders (org columns, tables, RLS)

Run after SQL 2.

```sql
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS reminder_email_day_before BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reminder_email_hour_before BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.booking_reminder_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('day_before', 'hour_before')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (booking_id, reminder_type)
);

CREATE INDEX IF NOT EXISTS idx_booking_reminder_sent_booking ON public.booking_reminder_sent(booking_id);

ALTER TABLE public.booking_reminder_sent ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No direct access to booking_reminder_sent"
  ON public.booking_reminder_sent FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.customer_reminder_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_email TEXT NOT NULL,
  email_reminder_day_before BOOLEAN NOT NULL DEFAULT true,
  email_reminder_hour_before BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, customer_email)
);

CREATE INDEX IF NOT EXISTS idx_customer_reminder_prefs_org ON public.customer_reminder_preferences(organization_id);

ALTER TABLE public.customer_reminder_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org owners can manage customer_reminder_preferences"
  ON public.customer_reminder_preferences FOR ALL
  USING (organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()));
CREATE POLICY "Service role can read customer_reminder_preferences"
  ON public.customer_reminder_preferences FOR SELECT
  USING (true);

CREATE TRIGGER update_customer_reminder_preferences_updated_at
  BEFORE UPDATE ON public.customer_reminder_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

---

## After SQL (if you used Option B): deploy reminder function

From your project root:

```bash
cd G:\booking-new-module
npx supabase functions deploy send-booking-reminders --no-verify-jwt
```

Ensure Edge Function secrets are set (Dashboard or `npx supabase secrets set ...` as in Option A step 4).

---

## Summary checklist

- [ ] SQL 1 (vat_rates + services.vat_rate_id) run
- [ ] SQL 2 (default VAT trigger + backfill) run
- [ ] SQL 3 (reminder columns + booking_reminder_sent + customer_reminder_preferences) run
- [ ] Edge function `send-booking-reminders` deployed
- [ ] `RESEND_API_KEY` and `RESEND_FROM_EMAIL` set (and optionally `CRON_SECRET`)
- [ ] Hourly cron calling `POST .../functions/v1/send-booking-reminders` (with `x-cron-secret` if you set `CRON_SECRET`)
