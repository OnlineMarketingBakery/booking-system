CREATE POLICY "Super admins can manage all orgs"
ON public.organizations
FOR ALL
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));