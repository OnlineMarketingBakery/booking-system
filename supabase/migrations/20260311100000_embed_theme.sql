-- Add embed theme customization (color palette + text) for the public booking widget
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS embed_theme jsonb DEFAULT NULL;

COMMENT ON COLUMN public.organizations.embed_theme IS 'Custom colors and copy for the embeddable booking widget. Example: {"primaryColor":"#7c3aed","primaryForegroundColor":"#ffffff","backgroundColor":"#f5f5f5","headingText":"Book an appointment","subheadingText":"Choose your service and time"}';

-- Recreate organizations_public view to expose embed_theme (read-only for anon on booking page)
DROP VIEW IF EXISTS public.organizations_public;
CREATE VIEW public.organizations_public AS
  SELECT id, name, slug, logo_url, embed_theme
  FROM public.organizations;
