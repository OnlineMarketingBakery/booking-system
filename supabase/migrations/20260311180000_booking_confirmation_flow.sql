-- Pending booking confirmations: store payload and token until customer clicks email link
CREATE TABLE IF NOT EXISTS pending_booking_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  save_my_info boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_booking_confirmations_token ON pending_booking_confirmations(token);
CREATE INDEX IF NOT EXISTS idx_pending_booking_confirmations_expires ON pending_booking_confirmations(expires_at) WHERE used_at IS NULL;

-- Customers who have confirmed at least once via email; returning customers can skip confirmation
CREATE TABLE IF NOT EXISTS confirmed_booking_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_email text NOT NULL,
  customer_name text,
  customer_phone text,
  has_confirmed_once boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, customer_email)
);

CREATE INDEX IF NOT EXISTS idx_confirmed_booking_customers_org_email ON confirmed_booking_customers(organization_id, customer_email);

-- RLS: only edge functions (service role) should access these tables
ALTER TABLE pending_booking_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE confirmed_booking_customers ENABLE ROW LEVEL SECURITY;
