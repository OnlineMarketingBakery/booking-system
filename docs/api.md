# API Documentation (Supabase Edge Functions + RPC)

This system is primarily a frontend SPA that uses Supabase for data access. Most “API” behavior is implemented as **Supabase Edge Functions** (HTTP endpoints) and a small set of **Postgres RPC functions**.

## Conventions
- **Invocation from frontend**: `supabase.functions.invoke("<function-name>", { body, headers })`
  - The custom auth token is attached as `Authorization: Bearer <token>` by `AuthContext.invokeFunction(...)` (`src/contexts/AuthContext.tsx`).
- **JWT verification**: configured per-function in `supabase/config.toml`. Many sensitive functions set `verify_jwt = false` and implement their own checks and/or rely on service role keys.

## Edge Functions (major)
### `auth-custom`
**Purpose**
- Custom authentication system for dashboard users.

**Used by**
- `src/contexts/AuthContext.tsx` (login/signup/password flows)

**Auth**
- `verify_jwt = false` (toml)

**Behavior (high-level)**
- Supports actions like:
  - `signup`, `signin`
  - password reset request + set new password
  - confirm password change
- Returns a custom JWT and user object on successful sign-in (stored in localStorage).

**Needs validation**
- Exact payload shapes for each action (see `supabase/functions/auth-custom/index.ts`).

### `request-booking-confirmation`
**Purpose**
- Start booking: validate request, hold slot, send confirmation email.

**Used by**
- Public booking page `src/pages/BookingPage.tsx`

**Auth**
- Not configured in `supabase/config.toml` (needs validation of deployed defaults).

**Outputs (observed in UI logic)**
- `confirm_sent` (email link required)
- `free` (no payment; can confirm directly)
- `url` (redirect to payment)

### `confirm-booking-by-token`
**Purpose**
- Confirm a pending booking request using a token from email.

**Used by**
- `src/pages/ConfirmBookingPage.tsx`

**Auth**
- Not configured in `supabase/config.toml` (needs validation of deployed defaults).

### `create-booking-checkout`
**Purpose**
- Server-side creation of booking(s) and Stripe checkout session (if payment applies).

**Auth**
- `verify_jwt = false` (toml)

**Key responsibilities**
- Conflict checking via RPC (`get_location_busy_intervals`), including pending holds.
- Writes booking records and Stripe identifiers.

### `verify-booking-payment`
**Purpose**
- Verify Stripe payment and finalize post-payment actions.

**Auth**
- `verify_jwt = false` (toml)

### `send-booking-email`
**Purpose**
- Send booking-related emails (confirmation, reminders, etc.) via Resend.

**Auth**
- `verify_jwt = false` (toml)

### `send-booking-reminders`
**Purpose**
- Cron-style sender for reminder emails.

**Auth**
- `verify_jwt = false` (toml)

**Security**
- Expects `x-cron-secret` header to match env `CRON_SECRET` (implementation in function code).

### `send-customer-email`
**Purpose**
- Send a manual email to a customer from the dashboard.

**Auth**
- `verify_jwt = true` (toml)

### Google Calendar functions
These functions support OAuth, event sync, and event fetching:
- `google-auth-callback` (verify_jwt=false) — exchanges OAuth code for tokens and stores them.
- `fetch-gcal-events` (verify_jwt=false) — fetch events for calendar UI.
- `sync-booking-to-gcal` (verify_jwt=false) — create/update event corresponding to a booking.
- `delete-gcal-event` (not configured in toml; needs validation) — delete a linked event.
- `disconnect-gcal` (verify_jwt=false) — disconnect integration (token state tracking + log).
- `backfill-bookings-to-gcal` (verify_jwt=false) — create events for historic bookings.

### Plug&Pay provisioning (SaaS buyers → Salonora accounts)
- **`plugnpay-provision-accounts`** (`verify_jwt=false`) — Super-admin JWT or `X-Plugnpay-Cron-Secret`; lists all Plug&Pay orders via API and provisions missing billing emails (welcome email with “create password” link). Same optional **`PLUGNPAY_PROVISION_PRODUCT_IDS`** filter as the webhook. Needs `PLUGNPAY_API_KEY` and shared logic in `_shared/plugnpay-provision-buyer.ts`.
- **`plugnpay-order-webhook`** (`verify_jwt=false`) — `POST` JSON from Plug&Pay **Order created** / Webhook V2. Authenticate with query `?secret=` and/or header `X-Salonora-Webhook-Secret` matching Supabase secret **`PLUGNPAY_WEBHOOK_SECRET`**. Optional **`PLUGNPAY_PROVISION_PRODUCT_IDS`** (comma-separated Plug&Pay product ids): if set, the order must include a line item with `product_id` / `product.id` in that list or provisioning is skipped (`skipped: true`, `reason: product_not_in_allowlist`). Resolves `billing.contact`, `billing_details`, or hydrates the order with `PLUGNPAY_API_KEY` if needed. Returns **200** on success/skip so Plug&Pay does not retry forever.

## SaaS administration functions (super admin)
Used by the super admin dashboard to manage users and tenant accounts:
- `get-pending-signups` (verify_jwt=false) — list users awaiting approval.
- `approve-user` / `reject-user` (verify_jwt=false) — approval workflow.
- `admin-update-user` (not configured in toml; needs validation) — user updates (role/name/etc.).
- `admin-delete-user` (verify_jwt=false) — delete a user.
- `create-salon-owner` (verify_jwt=false) — create tenant org + owner.

## Postgres RPC functions
### `get_location_busy_intervals(p_location_id, p_start, p_end, p_exclude_pending_token)`
**Purpose**
- Returns busy intervals for a location in a time range, combining:
  - confirmed bookings
  - active pending booking confirmation holds (optionally excluding a given token)

**Used by**
- Booking creation functions (server-side conflict checks)
- Booking widget logic (via client queries/invocations depending on implementation)

**Location**
- Migrations:
  - `supabase/migrations/20260318120000_get_location_busy_intervals.sql`
  - `supabase/migrations/20260318140000_pending_confirmation_slot_holds.sql`

**Auth**
- Defined as `SECURITY DEFINER` and granted to `anon`, `authenticated`, and `service_role` (per migrations).

### `has_role(role)` and `get_user_organization_ids()`
**Purpose**
- Provide RLS helper logic for role checks and org membership.

**Location**
- `supabase/migrations/20260211063614_b0cc7ebf-852c-43c5-92cd-486cc39251f2.sql`

## Error patterns (observed)
- Edge functions typically return JSON `{ error: string }` on failure.
- Frontend often surfaces `error.message` from `supabase.functions.invoke(...)`.
- Booking operations rely on server-side conflict checks; if a slot is no longer available, the user should receive an error (exact copy depends on function code).

## Security notes / needs validation
- Not every function appears in `supabase/config.toml`. Function JWT verification defaults are environment-dependent; validate deployed settings in Supabase.
