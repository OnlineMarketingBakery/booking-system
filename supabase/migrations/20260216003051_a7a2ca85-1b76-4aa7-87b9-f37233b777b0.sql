
-- Add tier enum and column to organizations
CREATE TYPE public.org_tier AS ENUM ('tier_1', 'tier_2', 'tier_3');

ALTER TABLE public.organizations
ADD COLUMN tier public.org_tier NOT NULL DEFAULT 'tier_1';
