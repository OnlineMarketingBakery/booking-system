# Feature-by-feature documentation

This document describes each major feature as implemented. If something is uncertain from code alone, it is marked as **inferred** or **needs validation**.

## 1) Authentication & account approval
### Purpose
Allow users to access the dashboard with role-based capabilities and (for some users) an approval workflow.

### Who uses it
- Salon owners/managers
- Staff members
- Super admins (platform operators)

### How it works (implementation)
- Frontend stores a **custom JWT** in localStorage (`custom_auth_token`) and reads it in the Supabase client `accessToken` callback (`src/integrations/supabase/client.ts`).
- The dashboard login/signup uses an edge function (`auth-custom`) rather than Supabase Auth sessions (`src/contexts/AuthContext.tsx`).
- Sign-up may return `{ pending: true }` (approval flow), in which case the user is not logged in automatically.
- User roles are stored in `user_roles` and loaded by the frontend after login.

### Main UI screens
- `src/pages/Auth.tsx`
- `src/pages/ResetPassword.tsx`
- `src/pages/ConfirmPasswordChange.tsx`

### Backend logic
- Edge function: `supabase/functions/auth-custom`
- Tables: `app_users` (custom auth) + role tables (`user_roles`)

### Technical notes / edge cases
- The repo contains both Supabase Auth triggers (creating `profiles`/roles on `auth.users`) and a custom `app_users` system. The interaction between the two is **complex** and should be validated end-to-end in a staging environment.

## 2) Organization onboarding / salon setup
### Purpose
Ensure an owner configures enough data to accept bookings: location hours, services, staff.

### Who uses it
- Salon owner

### How it works
- Owner dashboard shows onboarding if the user has no organization (`src/pages/dashboard/Overview.tsx` renders `OnboardingWizard`).

### Main UI screens
- `src/components/OnboardingWizard.tsx`

### Data involved
- `organizations`, `locations`, `location_availability`, `services`, `staff`

## 3) Locations & opening hours
### Purpose
Define where the salon operates and when it is open.

### Who uses it
- Salon owner

### How it works
- Locations are managed in `src/pages/dashboard/Locations.tsx`.
- Opening hours are stored in `location_availability` per location and weekday (migration `20260311110000_location_availability.sql`).
- Updating location hours rewrites the availability rows (delete + insert).

### UI screens
- Dashboard → Locations (`src/pages/dashboard/Locations.tsx`)

### Backend/data
- Tables: `locations`, `location_availability`

### Rules/edge cases
- Tier-based location cap is enforced in UI (tier_1/tier_2/tier_3).

## 4) Services & VAT rates
### Purpose
Define what customers can book and pricing rules.

### Who uses it
- Salon owner

### How it works
- Services: create/edit/soft-delete via `src/pages/dashboard/Services.tsx`.
- VAT rates: managed in `src/pages/dashboard/SettingsPage.tsx` and referenced by services (`vat_rate_id`).
- Default VAT rates may be inserted automatically on organization creation (migration `20260311140000_default_vat_rates.sql`).

### UI screens
- Dashboard → Services
- Dashboard → Settings (VAT section)

### Data involved
- `services`, `vat_rates`

## 5) Staff management & location assignment
### Purpose
Maintain staff roster and optionally assign bookings to staff.

### Who uses it
- Salon owner

### How it works
- Staff records created/edited/soft-deleted in `src/pages/dashboard/Staff.tsx`.
- Staff ↔ location is stored in `staff_locations`.
- Implementation currently enforces “one location per staff” (migration `20260316110000_staff_one_location_only.sql` + UI behavior in `src/components/StaffLocationAssignment.tsx`).

### Data involved
- `staff`, `staff_locations`

## 6) Public booking widget (customer booking)
### Purpose
Let customers book an appointment online.

### Who uses it
- Customers

### How it works (behavior)
- Page: `src/pages/BookingPage.tsx` (`/book/:slug`).
- Step flow: location → service → time → details.
- Supports selecting **multiple services**; duration and price are summed.
- Slot generation is performed client-side using:
  - opening hours (`location_availability`)
  - off days / holidays / overrides
  - closures (`location_closure_slots`)
  - breaks (`organization_break_slots`)
  - existing bookings + pending holds via RPC `get_location_busy_intervals`
  - a 15-minute buffer between bookings
  - optional Google Calendar conflicts (if connected and/or staff selected)

### Backend logic
- `request-booking-confirmation` initiates a pending hold and email confirmation.
- `confirm-booking-by-token` finalizes and forwards to checkout or immediate confirmation.
- `create-booking-checkout` performs server-side conflict checks and creates bookings + Stripe session when needed.

### Data involved
- `organizations_public`, `locations`, `services`, `staff_public`
- `pending_booking_confirmations`
- `bookings`

## 7) Booking confirmation flow (email)
### Purpose
Avoid fake/spam bookings and prevent slot races while the customer confirms.

### How it works
- Booking request stores a pending confirmation token and sends a link by email.
- Pending confirmations participate in busy-interval computation (migration `20260318140000_pending_confirmation_slot_holds.sql`).

### Data involved
- `pending_booking_confirmations`
- RPC `get_location_busy_intervals(...)`

## 8) Payments (Stripe) — if enabled
### Purpose
Collect payments during booking.

### How it works
- Checkout session created server-side; customer is redirected.
- After payment, verification function updates booking and triggers notifications and possibly GCal sync.

### Backend logic
- `create-booking-checkout`
- `verify-booking-payment`

### Needs validation
- Which services/orgs require payment, and whether deposits are supported (not clearly visible from the high-level scan).

## 9) Dashboard bookings management
### Purpose
Allow owners to operationally manage bookings.

### How it works
- List/search/filter bookings and change staff assignment + status in `src/pages/dashboard/Bookings.tsx`.
- Rescheduling adjusts start/end based on service duration and sets status to confirmed.

### Data involved
- `bookings`, `services`, `staff`

## 10) Dashboard calendar
### Purpose
Provide a weekly visualization and management surface for bookings.

### How it works
- `src/pages/dashboard/CalendarPage.tsx`
- Pulls bookings for a week, and optionally fetches Google Calendar events.
- Can create bookings directly by clicking a slot (owner operational booking creation).

### Integrations
- `fetch-gcal-events`, `delete-gcal-event` (and sync functions)

## 11) Holidays, off-days, and closures
### Purpose
Model real-world availability exceptions.

### How it works
- `src/pages/dashboard/HolidaysPage.tsx` manages:
  - holiday region (`organizations.holiday_region`)
  - public holiday overrides (`organization_holiday_overrides`)
  - off days (`organization_off_days`)
  - time-window closures (`location_closure_slots`)

## 12) Customers + reminders
### Purpose
Track repeat customers and control reminder behavior.

### How it works
- Customers list derived from confirmed bookings (`confirmed_booking_customers`).
- Per-customer reminder preferences in `customer_reminder_preferences`; org defaults exist on `organizations`.
- Reminder job is implemented as an edge function invoked by external cron.

### UI screens
- `src/pages/dashboard/Customers.tsx`

### Backend logic
- `send-booking-reminders`, `send-booking-email`

## 13) Embed + theming
### Purpose
Let salons embed the booking widget on their website and apply basic branding.

### How it works
- `src/pages/dashboard/Embed.tsx` provides link + iframe code.
- Theme stored on `organizations.embed_theme` and passed to booking widget via query params for preview.

## 14) Super admin: tenant and user administration
### Purpose
Operate the SaaS: approve users and manage tenant accounts.

### How it works
- UI pages: `src/pages/dashboard/SuperAdminDashboard.tsx`, `src/pages/dashboard/SuperAdminAccounts.tsx`.
- Edge functions handle privileged actions (approve/reject, admin update/delete, create owner/org).

