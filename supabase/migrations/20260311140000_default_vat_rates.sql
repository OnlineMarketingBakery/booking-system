-- Function to insert the 4 default VAT rates for an organization (English only; frontend handles translation for display)
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

-- Trigger function: on organization insert, seed default VAT rates
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

-- Trigger: when a new organization is created, add default VAT rates
DROP TRIGGER IF EXISTS on_organization_created_insert_default_vat_rates ON public.organizations;
CREATE TRIGGER on_organization_created_insert_default_vat_rates
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_insert_default_vat_rates_on_org();

-- Backfill: add default VAT rates (English) for every existing organization that has none
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
