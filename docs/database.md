# Database and Data Model

This document describes the database schema as defined by SQL migrations under `supabase/migrations/`. It focuses on the entities that drive booking behavior and SaaS tenancy.

## 1) Multi-tenancy model
### Tenant boundary
- **Tenant = organization** (`organizations` table)
- Most operational tables include `organization_id` and are guarded by RLS helper functions like `get_user_organization_ids()`.

### Public data for booking widget
The public booking widget reads tenant data via:
- Views: `organizations_public`, `staff_public`
- “public select” policies on a subset of configuration tables (e.g., location availability and closures)

Exact grants/policies should be validated in migrations and in the deployed Supabase project.

## 2) Core entities
### `organizations`
Represents a salon tenant account.

Common fields (based on usage and migrations; validate exact columns in migrations):
- `id` (UUID)
- `name`
- `slug` (used in `/book/:slug`)
- `tier` (tier_1 / tier_2 / tier_3)
- `holiday_region`
- `embed_theme` (JSON)
- Reminder defaults (e.g., day-before/hour-before flags)
- Stripe configuration fields (e.g., `stripe_account_id`) if payments enabled

### `locations`
Represents a salon location.

- FK: `organization_id` → `organizations.id`
- Fields: name, address, phone, `is_active`

### `location_availability`
Opening hours per location per weekday.

- FK: `location_id` → `locations.id`
- Typical fields:
  - `weekday` (0–6 or 1–7; validate in migration)
  - `start_time`, `end_time` (time of day)
- Used by booking widget to decide which days have availability.

### `services`
Bookable services.

- FK: `organization_id` → `organizations.id`
- Fields: name, description, duration, price, currency, `is_active`
- Optional VAT: `vat_rate_id` → `vat_rates.id`

### `vat_rates`
VAT rates per organization.

- FK: `organization_id` → `organizations.id`
- Used by service pricing display/handling.

### `staff`
Staff members.

- FK: `organization_id` → `organizations.id`
- Optional FK: `user_id` linking a staff record to a logged-in staff user (used by staff portal).
- Fields: name, phone, `is_active`

### `staff_locations`
Staff ↔ location mapping.

- FK: `staff_id` → `staff.id`
- FK: `location_id` → `locations.id`
- Implementation enforces “one location per staff” (unique constraint/migration `20260316110000_staff_one_location_only.sql`).

### `bookings`
Appointments booked by customers.

- FK: `organization_id` → `organizations.id`
- FK: `location_id` → `locations.id`
- FK: `service_id` → `services.id` (note: public widget supports multi-service selection; validate whether this is stored as a single service or expanded to multiple bookings)
- Optional FK: `staff_id` → `staff.id` (nullable)
- Core fields:
  - `start_time`, `end_time`
  - customer: `customer_name`, `customer_email`, `customer_phone`
  - `status` enum: `pending`, `confirmed`, `paid`, `cancelled`, `completed`, `no_show`
- Payment fields (Stripe): `stripe_session_id`, `stripe_payment_intent_id` (names inferred from migration scan)
- Calendar fields: `gcal_event_id` (migration `20260316000000_bookings_gcal_event_id.sql`)
- UI display fields: `customer_slot_date`, `customer_slot_time` (migration `20260318160000_bookings_customer_slot_display.sql`)

Constraints / indexes:
- Partial unique index preventing double booking for the same staff at the same start time (when staff is assigned) (migration `20260311120000_bookings_staff_id_nullable.sql`).

## 3) Booking confirmation and holds
### `pending_booking_confirmations`
Stores pending booking requests awaiting email confirmation.

Purpose:
- Prevent slot races by holding time windows while customer confirms.

Notes:
- RLS is enabled and appears to be service-role managed in practice.
- Integrated into `get_location_busy_intervals` so pending holds are treated as busy.

### `confirmed_booking_customers`
Stores a “customer directory” for an organization based on confirmed bookings.

### `customer_reminder_preferences`
Stores per-customer reminder overrides (e.g., day-before/hour-before email reminders).

### `booking_reminder_sent`
Dedupe table to prevent sending duplicate reminders for the same booking and reminder type.

## 4) Availability exceptions
### `organization_off_days`
Blocks whole days org-wide or per location (supports reason and optional `location_id`).

### `organization_holiday_overrides`
Allows overriding a computed public holiday to be a working day (or vice versa depending on implementation).

### `location_closure_slots`
Blocks a specific time window on a date, org-wide or per location.

### `organization_break_slots` and `organization_break_slot_staff`
Represents break windows that should block bookings.

Notes:
- Breaks can apply to the whole salon and/or to specific staff (based on usage in the booking widget).

## 5) Google Calendar integration tables
### `google_calendar_tokens`
Stores OAuth tokens for a user who connected Google Calendar.

### `gcal_disconnect_log`
Tracks disconnect events and likely supports soft-disconnect logic.

## 6) User/role tables
### `user_roles`
Maps users to `app_role` enum values: `super_admin`, `salon_owner`, `staff`, `customer`.

### `profiles`
Profile table linked to Supabase Auth users (trigger-created on `auth.users` insert).

### `app_users`
Custom-auth users table used by `auth-custom` and super admin approval workflow.

## 7) Relationships summary (conceptual)
- Organization 1—* locations
- Organization 1—* services
- Organization 1—* staff
- Organization 1—* bookings
- Location 1—* location_availability
- Staff *—1 location (via staff_locations; enforced as single location per staff in current schema)
- Service 0..1 — VAT rate
- Booking *—1 location, *—1 service, *—0..1 staff

## 8) Needs validation / inferred points
- Multi-service booking storage: the UI supports selecting multiple services; verify whether backend stores:
  - multiple booking rows, or
  - a single booking with composite service info, or
  - a join table (not observed in the high-level scan).
- Exact list of columns on `organizations` for reminders and Stripe settings.
- Public grants on views/tables in the deployed environment.

