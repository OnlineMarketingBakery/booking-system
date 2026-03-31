# Developer Documentation

## Tech stack
### Frontend
- **Vite + React + TypeScript** (`package.json`)
- **Routing**: `react-router-dom` (`src/App.tsx`)
- **Data fetching / caching**: TanStack Query (`@tanstack/react-query`)
- **UI**: shadcn-ui/Radix primitives + TailwindCSS (`src/components/ui/*`, `src/index.css`)
- **Forms/validation**: `react-hook-form`, `zod` (`@hookform/resolvers`)
- **Charts**: `recharts` (dashboard analytics)

### Backend
- **Supabase Postgres** with RLS, views, triggers, and RPC SQL functions (`supabase/migrations/*`)
- **Supabase Edge Functions** (Deno) for server-side workflows (`supabase/functions/*`)

### Integrations
- **Email**: Resend (Edge Functions like `send-booking-email`, `send-customer-email`)
- **Payments**: Stripe (Edge Functions like `create-booking-checkout`, `verify-booking-payment`)
- **Calendar**: Google Calendar OAuth + events sync (`google-auth-callback`, `sync-booking-to-gcal`, etc.)

## Application architecture (high-level)
### Runtime components
- **SPA frontend** communicates with Supabase via:
  - `@supabase/supabase-js` for database queries and invoking edge functions
  - A custom auth token stored in localStorage, attached to requests (`src/contexts/AuthContext.tsx`, `src/integrations/supabase/client.ts`)
- **Supabase Postgres** stores tenants (organizations), operational data (locations, services, staff, bookings), and configuration (availability, holidays, breaks, embed theme).
- **Edge Functions** implement workflows requiring service role or secrets (payments, emails, Google OAuth).

### Tenancy model
The system is multi-tenant by **organization**:
- Most tables include `organization_id` and are protected with RLS helpers (e.g., `get_user_organization_ids()` in migrations).
- Public booking uses **public views** (e.g., `organizations_public`, `staff_public`) and/or explicitly public-select tables for booking configuration.

## Frontend structure
### Key entrypoints
- `src/main.tsx` — renders app
- `src/App.tsx` — router + providers

### Pages
- Public booking:
  - `src/pages/BookingPage.tsx` — booking widget (`/book/:slug`)
  - `src/pages/ConfirmBookingPage.tsx` — confirm via token (`/book/confirm`)
  - `src/pages/ThankYouPage.tsx` — success (`/book/success`)
  - `src/pages/ReleaseHoldPage.tsx` — release pending hold (`/book/release-hold`)
- Auth:
  - `src/pages/Auth.tsx` — sign-in/up
  - `src/pages/ResetPassword.tsx`, `src/pages/ConfirmPasswordChange.tsx`
- Dashboard:
  - `src/components/DashboardLayout.tsx`, `src/components/DashboardSidebar.tsx`
  - `src/pages/dashboard/*` — owner/staff/admin screens

### Auth and authorization (frontend)
- Custom auth token is stored in localStorage (`custom_auth_token`).
- Roles are loaded from the `user_roles` table and used for UI gating (`useAuth().hasRole(...)`).
- Route-level enforcement is limited to “signed in” via `ProtectedRoute` (`src/components/ProtectedRoute.tsx`). Owner-only enforcement is largely done via sidebar + page behavior; ensure RLS policies enforce real security.

## Backend structure
### Database migrations
All schema, RLS policies, views, triggers, and RPC functions are defined in:
- `supabase/migrations/*.sql`

Notable concepts in migrations:
- Core entities: organizations, locations, staff, services, bookings
- Availability primitives:
  - `location_availability` (opening hours windows per weekday)
  - `organization_off_days`, `organization_holiday_overrides`
  - `location_closure_slots` (block hours windows)
  - `organization_break_slots` (+ `organization_break_slot_staff`)
- Booking confirmation flow tables:
  - `pending_booking_confirmations` (email confirmation hold)
  - `confirmed_booking_customers`, `customer_reminder_preferences`
- Reminders:
  - `booking_reminder_sent` (dedupe)
- Integrations:
  - `google_calendar_tokens`, `gcal_disconnect_log`
  - Stripe fields on `organizations` and `bookings`

### Edge Functions
Edge functions live under `supabase/functions/<function-name>/index.ts` and are invoked via `supabase.functions.invoke(...)` from the frontend or by external callers (cron/webhooks).

Important functions (implementation-backed; see `docs/api.md` for details):
- **Auth**: `auth-custom` — sign-up/sign-in, password flows, and custom JWT issuance.
- **Bookings & payments**:
  - `request-booking-confirmation` — starts email-confirmation flow and holds the slot.
  - `confirm-booking-by-token` — confirms a pending request and continues to checkout or immediate confirmation.
  - `create-booking-checkout` — conflict checks, inserts booking(s), and creates Stripe checkout if needed.
  - `verify-booking-payment` — handles payment verification and post-payment actions (email/sync).
  - `cancel-pending-booking-hold` — releases pending holds.
- **Email**:
  - `send-booking-email` — booking emails + reminders.
  - `send-customer-email` — manual email from dashboard (JWT required).
  - `send-booking-reminders` — cron-invoked reminders using `CRON_SECRET`.
- **Google Calendar**:
  - `google-auth-callback`, `fetch-gcal-events`, `sync-booking-to-gcal`, `delete-gcal-event`, `disconnect-gcal`, `backfill-bookings-to-gcal`.
- **SaaS admin**:
  - `get-pending-signups`, `approve-user`, `reject-user`, `admin-update-user`, `admin-delete-user`, `create-salon-owner`.

### Environment variables and configuration (Edge Functions)
The code references (non-exhaustive; validate in function files):
- **Supabase**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Custom auth**: `JWT_SECRET`
- **Email**: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`
- **Stripe**: `STRIPE_SECRET_KEY`
- **Google OAuth**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`
- **App URLs**: `APP_URL` (used in emails and OAuth redirects)
- **Reminders scheduling**: `CRON_SECRET` (checked via request header `x-cron-secret`)
- **Timezone for emails**: `BOOKING_EMAIL_TIMEZONE` (defaults to `Europe/Amsterdam` in function code paths)

### Security model (developer notes)
- **Do not rely on frontend role gating**. Enforce access in Postgres via RLS and in edge functions via JWT verification and/or service role.
- **Public booking** depends on:
  - public views/tables for organization + booking configuration
  - server-side conflict checking via RPC and booking creation in edge functions

## Database access patterns
- Frontend uses `supabase.from(...).select(...)` and `supabase.functions.invoke(...)`.
- Some critical operations are intentionally server-side:
  - booking creation + payment creation/verification
  - email sending
  - Google OAuth token handling and event sync

## Validation and error handling
- Frontend uses zod + form validation patterns via `react-hook-form` (varies by page).
- Edge functions typically return JSON with `error` fields; frontend often displays `error.message` from `supabase.functions.invoke`.
- Booking flow includes server-side conflict checks (via SQL RPC) to prevent double booking.

## Background jobs / cron
There is no in-database cron schedule defined in migrations. Reminder sending is implemented as an edge function (`send-booking-reminders`) that expects an external scheduler to call it with `x-cron-secret`.

## Testing
- `vitest` is configured (`package.json`), with example tests under `src/test/*`.

## Deployment notes (high-level)
- Frontend is a static SPA build produced by `vite build`.
- Supabase migrations and edge functions must be deployed to the target Supabase project.
- The Supabase project id in `supabase/config.toml` and `src/integrations/supabase/client.ts` is `pgcvqaexvnwwskdhooly` (adjust for other environments).
 - The repo includes hosting headers to allow iframe embedding of `/book/*`:
   - Netlify: `netlify.toml`
   - Vercel: `vercel.json`
   These set `Content-Security-Policy: frame-ancestors *` for booking routes.

## Setup and run instructions (implementation-backed)
### Prerequisites
- Node.js + npm
- Access to the target Supabase project (or a local Supabase environment)

### Install

```bash
npm i
```

### Run locally (frontend)

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Tests

```bash
npm test
```

### Supabase database setup
Apply migrations in `supabase/migrations/` to your Supabase project. The schema includes:
- core tenant entities
- availability tables
- booking confirmation flow
- RLS policies and helper functions
- views used by public booking (`organizations_public`, `staff_public`)

### Supabase edge functions setup
Deploy edge functions under `supabase/functions/`.

Key config file:
- `supabase/config.toml` (per-function `verify_jwt` flags)

### Required environment variables (edge functions)
Set these in your Supabase function environment:
- Supabase: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Auth: `JWT_SECRET`
- Email: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`
- Payments (optional): `STRIPE_SECRET_KEY`
- Google Calendar (optional): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `APP_URL`
- Reminders (optional but recommended): `CRON_SECRET`

### Common caveats
- The frontend Supabase URL and anon key are currently hard-coded in `src/integrations/supabase/client.ts` (generated file). If you use multiple environments, you’ll want environment-based configuration.
- Reminder sending requires an external scheduler to call `send-booking-reminders` with `x-cron-secret`.
