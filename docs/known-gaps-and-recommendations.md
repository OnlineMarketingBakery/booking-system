# Risks, Gaps, and Recommendations

This document highlights unclear areas, potential risks, and suggested improvements based on the current codebase.

## 1) Areas that need validation (unclear from code scan)
- **Multi-service booking storage**: The public booking UI supports selecting multiple services, but the observed schema suggests a single `service_id` on `bookings`. Confirm whether multi-service is stored as multiple booking rows, a join table, or encoded in another structure.
- **Edge function JWT verification defaults**: Not all edge functions appear in `supabase/config.toml`. Confirm deployed `verify_jwt` settings in Supabase for every function, especially public booking functions (`request-booking-confirmation`, `confirm-booking-by-token`).
- **Auth model coherence**: The repo includes both:
  - Supabase Auth triggers (`auth.users` → `profiles` + default `user_roles`), and
  - a custom `app_users` password-hash + approval system used by `auth-custom`.
  Confirm the intended source of truth, and whether both are required.
- **Google Calendar “source of truth”**: Dashboard calendar appears to prioritize Google Calendar events when connected. Confirm whether GCal should override DB bookings display and whether GCal conflicts should always block booking slots.
- **Customer self-service cancellation/rescheduling**: No dedicated public routes were found beyond confirmation and payment cancel. Confirm whether customer self-cancel/reschedule is required.

## 2) Security concerns / audit points
- **Route-level enforcement**: `ProtectedRoute` enforces only “signed in” at router level. Owner-only pages appear mostly hidden via sidebar, not guarded by routes. Ensure RLS policies correctly prevent staff from accessing owner data by direct URL.
- **Functions with `verify_jwt = false`**: Many edge functions disable Supabase JWT verification. This can be valid when the function:
  - performs its own authorization, and/or
  - uses service role access carefully.
  Audit each function for proper checks and rate limiting (especially public booking endpoints).
- **Anonymous key in repo**: `src/integrations/supabase/client.ts` includes a publishable anon key. This is normal for Supabase client apps, but makes RLS correctness critical.

## 3) Scalability / maintainability observations
- **Slot generation is client-side**: Core slot computation is implemented in the frontend booking page. This can cause:
  - duplicated logic between client and server
  - subtle mismatches if server rules evolve
  - performance challenges if constraint sets grow large
  Recommendation: consider a server-side “available slots” endpoint/RPC to centralize logic.

- **Tier enforcement is UI-only**: Location caps are enforced in UI. Recommendation: enforce caps server-side (RLS constraints or edge functions) to prevent bypass.

- **Staff-to-location is single assignment**: The schema/UI enforce one location per staff. If multi-location staff is a future need, design a multi-select UI and remove the uniqueness constraint.

## 4) Product gaps / incomplete-feeling behaviors
- **Reminders require external scheduling**: Reminder sending is implemented as a function expecting external cron. If not configured, reminders will not run. Recommendation: document and provide a reference scheduler (e.g., Supabase scheduled functions, GitHub Actions, or a small worker).
- **Docs vs real README**: Root `README.md` is a generic Lovable template and does not describe this system. Recommendation: replace or augment with the new `README_MASTER.md` and link it clearly.

## 5) Recommendations (prioritized)
1. **Security**: Audit RLS and edge function authorization; add owner-only route guards for defense-in-depth.
2. **Availability correctness**: Centralize slot computation server-side or add validation that the chosen slot matches server-computed availability at confirmation time.
3. **Observability**: Add structured logging and error correlation IDs in edge functions (especially booking and payment).
4. **Operational tooling**: Add admin dashboards for email delivery health, reminder job status, and integration token state.
5. **Testing**: Add integration tests for booking confirmation + payment + reminder flows (currently only basic test scaffolding is visible).

