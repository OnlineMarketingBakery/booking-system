-- Allow org owners to read and upsert customer data so customer info persists when bookings are deleted
CREATE POLICY "Org owners can manage confirmed_booking_customers"
  ON public.confirmed_booking_customers
  FOR ALL
  USING (organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()));
