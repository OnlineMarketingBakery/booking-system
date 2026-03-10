-- Staff invitations: owner sends invite by email; only accepted invitees can be added as staff.
CREATE TABLE public.staff_invitations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  token TEXT NOT NULL UNIQUE,
  staff_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email)
);

CREATE INDEX idx_staff_invitations_org ON public.staff_invitations(organization_id);
CREATE INDEX idx_staff_invitations_token ON public.staff_invitations(token);
CREATE INDEX idx_staff_invitations_status ON public.staff_invitations(organization_id, status);

ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;

-- Org owners can manage invitations for their org
CREATE POLICY "Org owners can manage staff_invitations"
  ON public.staff_invitations FOR ALL
  USING (organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()));

-- Allow reading by token for accept page (via service role or we use edge function to accept)
-- No anon read by token for security; accept is done via edge function.

COMMENT ON TABLE public.staff_invitations IS 'Invitations sent by org owner; only accepted invitees can be added as staff.';
