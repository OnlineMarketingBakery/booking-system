-- Holiday region: default country code for public holidays (e.g. NL, US, DE)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS holiday_region text DEFAULT 'NL';

COMMENT ON COLUMN public.organizations.holiday_region IS 'ISO 3166-1 alpha-2 country code for public holidays (e.g. NL, US). Used as default when customer has not set a region.';

-- Override: mark a public holiday as a working day for this organization
CREATE TABLE IF NOT EXISTS public.organization_holiday_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  date date NOT NULL,
  is_working_day boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, date)
);

CREATE INDEX IF NOT EXISTS idx_org_holiday_overrides_org_date
  ON public.organization_holiday_overrides(organization_id, date);

COMMENT ON TABLE public.organization_holiday_overrides IS 'When is_working_day is true, this date (a public holiday) is treated as a working day for booking. Default for holidays is off.';

-- Custom off days: any date the admin marks as non-bookable
CREATE TABLE IF NOT EXISTS public.organization_off_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, date)
);

CREATE INDEX IF NOT EXISTS idx_org_off_days_org_date
  ON public.organization_off_days(organization_id, date);

COMMENT ON TABLE public.organization_off_days IS 'Custom dates marked by admin as off (no booking allowed).';

-- RLS: allow public read for booking page (only org_id and date are exposed)
ALTER TABLE public.organization_holiday_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_off_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read holiday overrides" ON public.organization_holiday_overrides;
CREATE POLICY "Public read holiday overrides" ON public.organization_holiday_overrides
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read off days" ON public.organization_off_days;
CREATE POLICY "Public read off days" ON public.organization_off_days
  FOR SELECT USING (true);

-- Org owners/admins manage via service role or auth; add policy for authenticated org members
DROP POLICY IF EXISTS "Org members manage holiday overrides" ON public.organization_holiday_overrides;
CREATE POLICY "Org members manage holiday overrides" ON public.organization_holiday_overrides
  FOR ALL USING (
    organization_id IN (SELECT get_user_organization_ids(auth.uid()))
  );

DROP POLICY IF EXISTS "Org members manage off days" ON public.organization_off_days;
CREATE POLICY "Org members manage off days" ON public.organization_off_days
  FOR ALL USING (
    organization_id IN (SELECT get_user_organization_ids(auth.uid()))
  );

-- Expose holiday_region on public view for booking widget
DROP VIEW IF EXISTS public.organizations_public;
CREATE VIEW public.organizations_public AS
  SELECT id, name, slug, logo_url, embed_theme, holiday_region
  FROM public.organizations;
