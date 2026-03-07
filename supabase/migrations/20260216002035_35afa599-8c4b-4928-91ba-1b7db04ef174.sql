
-- Change default signup role from 'customer' to 'salon_owner'
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), NEW.email);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'salon_owner');
  RETURN NEW;
END;
$function$;

-- Allow super_admins to view all profiles (needed for admin dashboard)
CREATE POLICY "Super admins can view all profiles"
ON public.profiles
FOR SELECT
USING (has_role(auth.uid(), 'super_admin'::app_role));

-- Allow super_admins to manage all user_roles
CREATE POLICY "Super admins can manage all roles"
ON public.user_roles
FOR ALL
USING (has_role(auth.uid(), 'super_admin'::app_role));
