# Roles and Permissions

This system defines four roles (enum `app_role` in migrations):
- `super_admin`
- `salon_owner`
- `staff`
- `customer`

Roles are stored in `user_roles` and loaded by the frontend (`src/contexts/AuthContext.tsx`) to drive navigation and screen access, but **true enforcement should be assumed to be RLS + edge function logic**.

## Role matrix (product-level)
| Capability | Salon owner | Staff | Customer | Super admin |
|---|---:|---:|---:|---:|
| Access dashboard | Yes | Yes (staff portal) | No | Yes |
| Manage locations + opening hours | Yes | No | No | Yes (tenant ops) |
| Manage services + VAT rates | Yes | No | No | Yes (tenant ops) |
| Manage staff | Yes | No | No | Yes (tenant ops) |
| View org bookings | Yes | Limited (assigned only) | No | Yes (platform visibility) |
| Assign staff / reschedule / change status | Yes | Needs validation (UI shows staff mostly read-only) | No | Yes |
| Configure holidays/off-days/closures | Yes | No | No | Yes |
| Configure embed settings | Yes | No | No | Yes |
| Public booking page | N/A | N/A | Yes | N/A |
| Approve/reject new signups | No | No | No | Yes |
| Create/manage tenant organizations | No | No | No | Yes |

## Frontend enforcement (what the UI does)
### Signed-in guard
- `ProtectedRoute` only requires an authenticated user (`src/components/ProtectedRoute.tsx`).

### Navigation gating
- Dashboard sidebar shows different menus based on role (`src/components/DashboardSidebar.tsx`).
  - Staff sees primarily “My bookings”.
  - Owners see management pages (Locations, Staff, Services, Calendar, Holidays, Embed, Customers, Settings).
  - Super admins see Admin Panel and Settings.

### Important note
Some “owner-only” pages may still be reachable by direct URL if route guards are not applied, so RLS policies and backend enforcement are critical.

## Backend enforcement (what should protect data)
### RLS helpers
Migrations define helper functions like:
- `has_role(role)`
- `get_user_organization_ids()`

These are typically used in RLS policies to restrict tenant access.

### Public access model
The booking widget requires unauthenticated access to a limited set of data:
- organization public data (via `organizations_public`)
- staff public data (via `staff_public`)
- location availability and closures / holiday rules

### Edge functions
Some edge functions have `verify_jwt = false` in `supabase/config.toml` but should still enforce permissions internally and/or use the service role key.

## Needs validation
- Whether staff can access any management pages via direct URL and whether RLS blocks it as intended.
- Which tables are exposed to `anon` via RLS for the booking widget.

