
-- =============================================
-- PHASE 1: ENUMS, TABLES, INDEXES
-- =============================================

-- 1. Create enums
CREATE TYPE public.app_role AS ENUM ('super_admin', 'salon_owner', 'staff', 'customer');
CREATE TYPE public.booking_status AS ENUM ('pending', 'confirmed', 'paid', 'cancelled', 'completed', 'no_show');

-- 2. Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. User roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- 4. Organizations table
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_account_id TEXT,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Locations table
CREATE TABLE public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Staff table
CREATE TABLE public.staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Staff-Locations junction
CREATE TABLE public.staff_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (staff_id, location_id)
);

-- 8. Services table
CREATE TABLE public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. Availability table
CREATE TABLE public.availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. Bookings table
CREATE TABLE public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status booking_status NOT NULL DEFAULT 'pending',
  stripe_payment_intent_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent double booking at DB level
CREATE UNIQUE INDEX idx_no_double_booking ON public.bookings (staff_id, start_time) WHERE status NOT IN ('cancelled');

-- Performance indexes
CREATE INDEX idx_locations_org ON public.locations(organization_id);
CREATE INDEX idx_staff_org ON public.staff(organization_id);
CREATE INDEX idx_staff_user ON public.staff(user_id);
CREATE INDEX idx_services_org ON public.services(organization_id);
CREATE INDEX idx_availability_staff ON public.availability(staff_id);
CREATE INDEX idx_bookings_org ON public.bookings(organization_id);
CREATE INDEX idx_bookings_staff ON public.bookings(staff_id);
CREATE INDEX idx_bookings_start ON public.bookings(start_time);
CREATE INDEX idx_bookings_status ON public.bookings(status);
CREATE INDEX idx_organizations_slug ON public.organizations(slug);
CREATE INDEX idx_organizations_owner ON public.organizations(owner_id);

-- =============================================
-- PHASE 2: FUNCTIONS (now staff table exists)
-- =============================================

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.get_user_organization_ids(_user_id UUID)
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id FROM public.organizations WHERE owner_id = _user_id
  UNION
  SELECT DISTINCT s.organization_id FROM public.staff s WHERE s.user_id = _user_id
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), NEW.email);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'customer');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================
-- PHASE 3: RLS POLICIES
-- =============================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Super admins can manage roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'super_admin'));

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners can manage own orgs" ON public.organizations FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY "Staff can view their org" ON public.organizations FOR SELECT USING (id IN (SELECT public.get_user_organization_ids(auth.uid())));
CREATE POLICY "Super admins can view all orgs" ON public.organizations FOR SELECT USING (public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Public can view orgs by slug" ON public.organizations FOR SELECT USING (true);

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org owners can manage locations" ON public.locations FOR ALL USING (organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()));
CREATE POLICY "Public can view active locations" ON public.locations FOR SELECT USING (is_active = true);

ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org owners can manage staff" ON public.staff FOR ALL USING (organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()));
CREATE POLICY "Staff can view themselves" ON public.staff FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Public can view active staff" ON public.staff FOR SELECT USING (is_active = true);

ALTER TABLE public.staff_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org owners can manage staff_locations" ON public.staff_locations FOR ALL USING (staff_id IN (SELECT id FROM public.staff WHERE organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid())));
CREATE POLICY "Public can view staff_locations" ON public.staff_locations FOR SELECT USING (true);

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org owners can manage services" ON public.services FOR ALL USING (organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()));
CREATE POLICY "Public can view active services" ON public.services FOR SELECT USING (is_active = true);

ALTER TABLE public.availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org owners can manage availability" ON public.availability FOR ALL USING (staff_id IN (SELECT id FROM public.staff WHERE organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid())));
CREATE POLICY "Staff can manage own availability" ON public.availability FOR ALL USING (staff_id IN (SELECT id FROM public.staff WHERE user_id = auth.uid()));
CREATE POLICY "Public can view availability" ON public.availability FOR SELECT USING (true);

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org owners can manage bookings" ON public.bookings FOR ALL USING (organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()));
CREATE POLICY "Staff can view their bookings" ON public.bookings FOR SELECT USING (staff_id IN (SELECT id FROM public.staff WHERE user_id = auth.uid()));
CREATE POLICY "Anyone can create bookings" ON public.bookings FOR INSERT WITH CHECK (true);
CREATE POLICY "Super admins can view all bookings" ON public.bookings FOR SELECT USING (public.has_role(auth.uid(), 'super_admin'));

-- =============================================
-- PHASE 4: TRIGGERS
-- =============================================

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_locations_updated_at BEFORE UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_staff_updated_at BEFORE UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_services_updated_at BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Enable realtime for bookings
ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
