-- ============================================================
-- FULL POSTGRESQL SCHEMA EXPORT
-- Project: OnlineMarketingBakery's Booking
-- Generated: 2026-02-24
-- Compatible with: PostgreSQL 15+
-- ============================================================

-- ============================================================
-- 1. EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 2. CUSTOM ENUMS
-- ============================================================
CREATE TYPE app_role AS ENUM ('super_admin', 'salon_owner', 'staff', 'customer');
CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'paid', 'cancelled', 'completed', 'no_show');
CREATE TYPE org_tier AS ENUM ('tier_1', 'tier_2', 'tier_3');

-- ============================================================
-- 3. TABLES
-- ============================================================

-- app_users (custom auth; required for login/signup)
CREATE TABLE public.app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- profiles
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- user_roles
CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- organizations
CREATE TABLE public.organizations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  owner_id UUID NOT NULL,
  logo_url TEXT,
  stripe_account_id TEXT,
  tier org_tier NOT NULL DEFAULT 'tier_1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- locations
CREATE TABLE public.locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- services
CREATE TABLE public.services (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  price NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  is_active BOOLEAN NOT NULL DEFAULT true,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- staff
CREATE TABLE public.staff (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  user_id UUID,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- staff_locations
CREATE TABLE public.staff_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id UUID NOT NULL REFERENCES public.staff(id),
  location_id UUID NOT NULL REFERENCES public.locations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- availability
CREATE TABLE public.availability (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id UUID NOT NULL REFERENCES public.staff(id),
  day_of_week INTEGER NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- bookings
CREATE TABLE public.bookings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  location_id UUID NOT NULL REFERENCES public.locations(id),
  staff_id UUID NOT NULL REFERENCES public.staff(id),
  service_id UUID NOT NULL REFERENCES public.services(id),
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status booking_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  stripe_session_id TEXT,
  stripe_payment_intent_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- google_calendar_tokens (one row per user)
CREATE TABLE public.google_calendar_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. VIEWS
-- ============================================================

CREATE OR REPLACE VIEW public.organizations_public AS
  SELECT id, name, slug, logo_url
  FROM public.organizations;

CREATE OR REPLACE VIEW public.staff_public AS
  SELECT id, name, organization_id, is_active, created_at, updated_at
  FROM public.staff;

-- ============================================================
-- 5. FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.get_user_organization_ids(_user_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT id FROM public.organizations WHERE owner_id = _user_id
  UNION
  SELECT DISTINCT s.organization_id FROM public.staff s WHERE s.user_id = _user_id
$$;

CREATE OR REPLACE FUNCTION public.create_organization_with_role(_name TEXT, _slug TEXT, _owner_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _org_id UUID;
BEGIN
  INSERT INTO public.organizations (name, slug, owner_id)
  VALUES (_name, _slug, _owner_id)
  RETURNING id INTO _org_id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_owner_id, 'salon_owner')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN _org_id;
END;
$$;

-- ============================================================
-- 6. TRIGGERS
-- ============================================================

CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_locations_updated_at
  BEFORE UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_services_updated_at
  BEFORE UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_staff_updated_at
  BEFORE UPDATE ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_app_users_updated_at
  BEFORE UPDATE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_google_calendar_tokens_updated_at
  BEFORE UPDATE ON public.google_calendar_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 7. ROW LEVEL SECURITY (RLS)
-- Note: RLS policies reference auth.uid() which is Supabase-specific.
-- If migrating away from Supabase, you'll need to replace auth.uid()
-- with your own authentication mechanism.
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_calendar_tokens ENABLE ROW LEVEL SECURITY;

-- ── app_users ──
CREATE POLICY "Users can view own record" ON public.app_users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own record" ON public.app_users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Service role full access" ON public.app_users FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Super admins can view all app_users" ON public.app_users FOR SELECT USING (has_role(auth.uid(), 'super_admin'));

-- ── profiles ──
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Super admins can view all profiles" ON public.profiles FOR SELECT USING (has_role(auth.uid(), 'super_admin'));

-- ── user_roles ──
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Super admins can manage all roles" ON public.user_roles FOR ALL USING (has_role(auth.uid(), 'super_admin'));

-- ── organizations ──
CREATE POLICY "Owners can manage own orgs" ON public.organizations FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY "Authenticated users can view their orgs" ON public.organizations FOR SELECT USING ((owner_id = auth.uid()) OR (id IN (SELECT get_user_organization_ids(auth.uid()))));
CREATE POLICY "Staff can view their org" ON public.organizations FOR SELECT USING (id IN (SELECT get_user_organization_ids(auth.uid())));
CREATE POLICY "Super admins can manage all orgs" ON public.organizations FOR ALL USING (has_role(auth.uid(), 'super_admin')) WITH CHECK (has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Super admins can view all orgs" ON public.organizations FOR SELECT USING (has_role(auth.uid(), 'super_admin'));

-- ── locations ──
CREATE POLICY "Org owners can manage locations" ON public.locations FOR ALL USING (organization_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()));
CREATE POLICY "Public can view active locations" ON public.locations FOR SELECT USING (is_active = true);

-- ── services ──
CREATE POLICY "Org owners can manage services" ON public.services FOR ALL USING (organization_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()));
CREATE POLICY "Public can view active services" ON public.services FOR SELECT USING (is_active = true);
CREATE POLICY "Anyone can view services that have bookings" ON public.services FOR SELECT USING (id IN (SELECT service_id FROM public.bookings));

-- ── staff ──
CREATE POLICY "Org owners can manage staff" ON public.staff FOR ALL USING (organization_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()));
CREATE POLICY "Authenticated users can view staff in their org" ON public.staff FOR SELECT USING (organization_id IN (SELECT get_user_organization_ids(auth.uid())));
CREATE POLICY "Staff can view themselves" ON public.staff FOR SELECT USING (user_id = auth.uid());

-- ── staff_locations ──
CREATE POLICY "Org owners can manage staff_locations" ON public.staff_locations FOR ALL USING (staff_id IN (SELECT s.id FROM staff s WHERE s.organization_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid())));
CREATE POLICY "Public can view staff_locations" ON public.staff_locations FOR SELECT USING (true);

-- ── availability ──
CREATE POLICY "Org owners can manage availability" ON public.availability FOR ALL USING (staff_id IN (SELECT s.id FROM staff s WHERE s.organization_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid())));
CREATE POLICY "Staff can manage own availability" ON public.availability FOR ALL USING (staff_id IN (SELECT s.id FROM staff s WHERE s.user_id = auth.uid()));
CREATE POLICY "Public can view availability" ON public.availability FOR SELECT USING (true);

-- ── bookings ──
CREATE POLICY "Org owners can manage bookings" ON public.bookings FOR ALL USING (organization_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()));
CREATE POLICY "Anyone can create bookings" ON public.bookings FOR INSERT WITH CHECK (true);
CREATE POLICY "Staff can view their bookings" ON public.bookings FOR SELECT USING (staff_id IN (SELECT s.id FROM staff s WHERE s.user_id = auth.uid()));
CREATE POLICY "Super admins can view all bookings" ON public.bookings FOR SELECT USING (has_role(auth.uid(), 'super_admin'));

-- ── google_calendar_tokens ──
CREATE POLICY "Users can view own tokens" ON public.google_calendar_tokens FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own tokens" ON public.google_calendar_tokens FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own tokens" ON public.google_calendar_tokens FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own tokens" ON public.google_calendar_tokens FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Service role full access" ON public.google_calendar_tokens FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- 8. INDEXES (recommended)
-- ============================================================
CREATE INDEX idx_organizations_owner ON public.organizations(owner_id);
CREATE INDEX idx_organizations_slug ON public.organizations(slug);
CREATE INDEX idx_staff_organization ON public.staff(organization_id);
CREATE INDEX idx_staff_user ON public.staff(user_id);
CREATE INDEX idx_locations_organization ON public.locations(organization_id);
CREATE INDEX idx_services_organization ON public.services(organization_id);
CREATE INDEX idx_bookings_organization ON public.bookings(organization_id);
CREATE INDEX idx_bookings_staff ON public.bookings(staff_id);
CREATE INDEX idx_bookings_location ON public.bookings(location_id);
CREATE INDEX idx_bookings_service ON public.bookings(service_id);
CREATE INDEX idx_bookings_status ON public.bookings(status);
CREATE INDEX idx_availability_staff ON public.availability(staff_id);
CREATE INDEX idx_staff_locations_staff ON public.staff_locations(staff_id);
CREATE INDEX idx_staff_locations_location ON public.staff_locations(location_id);
CREATE INDEX idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX idx_google_calendar_tokens_user ON public.google_calendar_tokens(user_id);

-- ============================================================
-- END OF EXPORT
-- ============================================================
-- NOTES:
-- 1. RLS policies use auth.uid() and auth.role() which are Supabase-specific.
--    Replace these with your own auth mechanism on the new host.
-- 2. The handle_new_user() trigger function (attached to auth.users) is
--    Supabase-specific and is NOT included here. You'll need to implement
--    user creation hooks in your application layer.
-- 3. To export existing DATA, run:
--    pg_dump --data-only --no-owner -h <supabase-host> -U postgres -d postgres > data.sql
--    Your Supabase DB connection string is in the SUPABASE_DB_URL secret.
-- ============================================================
