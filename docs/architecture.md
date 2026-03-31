# Architecture

## 1) System Overview (plain language)
This application is a **SaaS salon booking system** with:
- A **public booking page** customers use to book appointments.
- A **dashboard** salon owners/managers use to configure their salon and manage bookings.
- A **staff portal** staff members use to view their bookings.
- A **platform admin** area SaaS operators use to approve users and manage tenant accounts.

Core business value:
- Reduces manual coordination by turning availability configuration + service definitions into a self-service booking flow.
- Automates booking confirmation and reminders (email).
- Optionally supports payments (Stripe) and calendar visibility (Google Calendar).

## 2) Architecture components
### Frontend (SPA)
- React SPA built with Vite (`package.json`).
- Routes defined in `src/App.tsx`.
- Uses Supabase JS client (`src/integrations/supabase/client.ts`) with a custom access token read from localStorage.

### Backend (Supabase)
#### Postgres
- All schema and policies are defined by SQL migrations under `supabase/migrations/`.
- Uses RLS heavily; helper functions like `get_user_organization_ids()` and `has_role()` appear in core migrations.
- Booking conflict checks rely on RPC: `get_location_busy_intervals(...)`.

#### Edge Functions (Deno)
- Business workflows live in `supabase/functions/*`.
- They hold secrets (Stripe/Resend/Google) and often use the service role key.
- Public booking relies on edge functions for “hold + confirm + checkout” behavior.

## 3) Main domains and how they connect
### Tenancy: organizations
An **organization** is the tenant boundary (a salon account). It owns:
- Locations
- Staff
- Services
- Booking rules (break slots, off days, holiday region, embed theme)
- Bookings and customer records

### Operations: bookings
Bookings reference:
- organization
- location
- service
- optional staff assignment
- customer contact fields
- status lifecycle (pending/confirmed/paid/completed/cancelled/no_show)

### Availability
Availability is composed from multiple layers:
- **Opening hours** per location and weekday: `location_availability` (set in Dashboard → Locations).
- **Public holidays** based on `organizations.holiday_region`, with overrides: `organization_holiday_overrides`.
- **Off days** that block whole days, org-wide or per-location: `organization_off_days`.
- **Closure slots** that block a time window on a date, org-wide or per-location: `location_closure_slots`.
- **Break slots** (business-level breaks + optional staff-specific applicability): `organization_break_slots` and `organization_break_slot_staff`.
- **Busy intervals** from existing bookings and pending confirmation holds: RPC `get_location_busy_intervals(...)`.
- **Optional Google Calendar conflicts** when Google is connected.

Discrete “bookable slots” are generated primarily in the **public booking UI** (`src/pages/BookingPage.tsx`) using the above constraints plus a built-in buffer of 15 minutes between bookings.

## 4) Core workflows (end-to-end)
### A) Customer booking flow (public)
**Routes/pages**
- `/book/:slug` → `src/pages/BookingPage.tsx`
- `/book/confirm?token=...` → `src/pages/ConfirmBookingPage.tsx`
- `/book/success?booking_id=...` → `src/pages/ThankYouPage.tsx`
- `/book/release-hold` → `src/pages/ReleaseHoldPage.tsx`

**Typical sequence (implementation-backed)**
1. Customer selects location/services/date/time and enters contact details.
2. Client calls edge function `request-booking-confirmation`.
   - Server creates a **pending confirmation hold** (in `pending_booking_confirmations`) to prevent races.
   - Server sends an email with a confirmation link.
3. Customer clicks confirmation link (`/book/confirm?token=...`).
4. Client calls `confirm-booking-by-token`.
   - Server revalidates and calls `create-booking-checkout`.
   - Outcomes:
     - **No payment required**: booking becomes confirmed and user lands on success.
     - **Payment required**: server returns a Stripe checkout URL for redirect.
5. After payment, the system verifies payment via `verify-booking-payment`, then sends emails and can sync to Google Calendar.

**Needs validation**
- Exact conditions for “free” vs “paid” bookings (depends on Stripe/org setup in edge function code).
- How and when the pending hold is released if customer abandons (there is a `cancel-pending-booking-hold` function and a release-hold page).

### B) Owner booking management (dashboard)
**Pages**
- Bookings list: `src/pages/dashboard/Bookings.tsx`
- Calendar: `src/pages/dashboard/CalendarPage.tsx`

**Key actions**
- Assign staff to bookings (or set unassigned).
- Reschedule bookings (updates start/end and sets status to confirmed).
- Update status (confirm/complete/cancel/no_show).

### C) Availability management (dashboard)
**Pages**
- Locations + opening hours: `src/pages/dashboard/Locations.tsx` + `src/components/LocationHoursForm.tsx`
- Holidays/off-days/closures: `src/pages/dashboard/HolidaysPage.tsx`
- Booking settings (breaks/automation): `src/pages/dashboard/BookingSettingsPage.tsx`

### D) Staff workflow (staff portal)
**Pages**
- `src/pages/dashboard/StaffPortal.tsx` — shows bookings assigned to the logged-in staff user.

### E) SaaS operator workflow (super admin)
**Pages**
- `src/pages/dashboard/SuperAdminDashboard.tsx`
- `src/pages/dashboard/SuperAdminAccounts.tsx`

**Capabilities**
- Approve/reject pending signups.
- Manage users, roles, organizations, tiers.

## 5) Integrations architecture
### Email (Resend)
- Used for: booking confirmation, reminders, manual customer emails, and admin notifications.
- Implemented via edge functions (e.g., `send-booking-email`, `send-customer-email`).

### Payments (Stripe)
- Used for customer checkout (if enabled).
- Booking records store Stripe identifiers (payment intent / session).
- Edge functions manage session creation and verification.

### Google Calendar
- OAuth tokens stored server-side (`google_calendar_tokens`).
- Edge functions fetch events for calendar display and can create/update/delete events linked to bookings.
- Dashboard calendar may show GCal events preferentially when connected (needs validation as “source of truth” expectation).

## 6) Data model (high-level)
Detailed database documentation is in `docs/database.md`. At a high level:
- `organizations` (tenant)
  - `locations` + `location_availability`
  - `services` (+ `vat_rates`)
  - `staff` (+ `staff_locations`)
  - `bookings` (linked to location/service/staff; includes Stripe + GCal fields)
  - booking rules: off-days, holiday overrides, closures, breaks
  - customer records + reminder preferences

## 7) Security and permissions (high-level)
See `docs/roles-and-permissions.md` for a role matrix.

Implementation notes:
- Frontend role-based navigation is not the security boundary.
- RLS policies and server-side edge functions are the enforcement layer.

## 8) Codebase structure (high-level map)
This is a curated map of the most important parts of the codebase.

### Top-level
- `src/`: React SPA
- `supabase/`: Supabase project assets (migrations, edge functions, config)
- `docs/`: product and developer documentation (this set)

### Frontend (`src/`)
- **Routing**: `src/App.tsx`
- **Auth + token management**: `src/contexts/AuthContext.tsx`
- **Supabase client + generated DB types**:
  - `src/integrations/supabase/client.ts`
  - `src/integrations/supabase/types.ts`
- **Dashboard layout + navigation**:
  - `src/components/DashboardLayout.tsx`
  - `src/components/DashboardSidebar.tsx`
- **Public booking flow**:
  - `src/pages/BookingPage.tsx`
  - `src/pages/ConfirmBookingPage.tsx`
  - `src/pages/ThankYouPage.tsx`
- **Owner dashboard screens**: `src/pages/dashboard/*`
  - Locations/hours: `Locations.tsx`, `LocationHoursForm.tsx`
  - Services: `Services.tsx`
  - Staff: `Staff.tsx`, `StaffLocationAssignment.tsx`
  - Bookings: `Bookings.tsx`
  - Calendar: `CalendarPage.tsx`
  - Holidays/off-days/closures: `HolidaysPage.tsx`
  - Customers + reminders: `Customers.tsx`
  - Embed: `Embed.tsx`
  - Settings: `SettingsPage.tsx`
  - Super admin: `SuperAdminDashboard.tsx`, `SuperAdminAccounts.tsx`

### Backend (`supabase/`)
- **Migrations**: `supabase/migrations/*.sql`
  - Base schema + RLS helpers: `20260211063614_*.sql`
  - Availability primitives: `20260311110000_location_availability.sql`, `20260317120000_location_closure_slots.sql`, `20260328120000_organization_break_slots.sql`
  - Booking confirmation: `20260311180000_booking_confirmation_flow.sql`, `20260318140000_pending_confirmation_slot_holds.sql`
  - Busy interval RPC: `20260318120000_get_location_busy_intervals.sql`
- **Edge functions**: `supabase/functions/*`
  - Booking flow: `request-booking-confirmation`, `confirm-booking-by-token`, `create-booking-checkout`, `verify-booking-payment`
  - Emails/reminders: `send-booking-email`, `send-booking-reminders`, `send-customer-email`
  - Google Calendar: `google-auth-callback`, `fetch-gcal-events`, `sync-booking-to-gcal`, etc.
  - Super admin: `approve-user`, `reject-user`, `get-pending-signups`, `create-salon-owner`, `admin-*`
