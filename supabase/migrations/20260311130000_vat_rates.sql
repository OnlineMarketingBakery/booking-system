-- VAT/BTW rates per organization (user-defined)
CREATE TABLE public.vat_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  percentage NUMERIC(5,2), -- null when percentage_disabled is true
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

-- Link services to a VAT rate (optional)
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS vat_rate_id UUID REFERENCES public.vat_rates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_services_vat_rate ON public.services(vat_rate_id);
