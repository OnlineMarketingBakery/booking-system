# Salon Booking System — Master README

## Executive summary
This repository contains a **multi-tenant SaaS salon booking system** consisting of:

- A **public booking experience** where customers choose a location, services, and a time slot, then confirm via email and optionally pay online.
- A **salon dashboard** for owners/managers to manage locations, staff, services, bookings, calendar visibility, holidays/off-days, reminders, and embed settings.
- A **platform admin area** for SaaS operators to approve users and manage salon accounts/tiers.

The product is implemented as a **Vite + React (TypeScript)** frontend and a **Supabase (Postgres + Edge Functions)** backend with row-level security and several business-critical server-side flows (booking creation, email confirmation, reminders, Google Calendar sync, Stripe checkout).

## Product overview (for non-technical readers)
If you run a salon, this platform helps you:

- Publish a booking page and embed it on your website.
- Define locations and opening hours.
- Create services (duration/price, optional VAT).
- Manage staff and assign them to a location.
- Receive bookings, assign staff, reschedule/cancel, and see a calendar view.
- Configure holidays, off-days, closures, and break times that affect available slots.
- Send booking emails and automated reminder emails.
- Optionally take payments via Stripe and sync bookings to Google Calendar.

For full client-facing documentation, see `docs/client-documentation.md`.

## Developer overview
### Tech stack
- **Frontend**: React 18, TypeScript, Vite, React Router, TanStack Query, shadcn-ui/Radix UI, TailwindCSS, zod, react-hook-form.
- **Backend**: Supabase Postgres (RLS policies + SQL migrations), Supabase Edge Functions (Deno).
- **Email**: Resend.
- **Payments**: Stripe (if configured).
- **Calendar**: Google Calendar OAuth + events sync (optional).
- **Testing**: Vitest + Testing Library.

See `docs/developer-documentation.md` and `docs/architecture.md`.

## Setup summary (quick start)
This project is a standard Vite app plus a Supabase project. Concrete setup steps depend on your environment variables and Supabase configuration.

- Install dependencies:

```bash
npm i
```

- Start frontend dev server:

```bash
npm run dev
```

- Supabase:
  - Apply migrations under `supabase/migrations/`.
  - Deploy edge functions under `supabase/functions/`.
  - Configure required environment variables for edge functions (see `docs/developer-documentation.md`).

## Documentation index (deliverables)
- `docs/client-documentation.md` — salon owners/managers and non-technical users
- `docs/developer-documentation.md` — developers/technical stakeholders
- `docs/architecture.md` — architecture, flows, integrations, and data model
- `docs/features.md` — feature-by-feature behavior
- `docs/api.md` — edge functions + RPC notes
- `docs/database.md` — tables, relationships, RLS/public views
- `docs/roles-and-permissions.md` — role matrix and access behavior
- `docs/business-rules.md` — booking/availability rules extracted from implementation
- `docs/known-gaps-and-recommendations.md` — inferred/unclear parts + recommendations

