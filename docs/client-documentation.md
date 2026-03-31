# Client Documentation (Salon Owners & Managers)

## What this platform is
This is a salon booking platform that lets you publish an online booking page, manage your salon setup (locations, services, staff, availability), and handle bookings from a dashboard.

It is designed for:
- **Salon owners/managers** who configure the salon and manage bookings.
- **Staff members** who view their assigned bookings.
- **Customers** who book appointments online.

## Key modules (what you can do)
### 1) Locations & opening hours
You can create one or more **locations** and set each location’s **opening hours** per day of the week.

- **Where**: Dashboard → Locations
- **What it affects**: Available days and time windows customers can book.
- **Notes**:
  - The system supports **tier-based** limits for how many locations you can create (see “Plans / tiers” below).

### 2) Services (what customers book)
You define your salon services, each with:
- Name and description
- Duration (minutes)
- Price and currency
- Optional VAT rate

- **Where**: Dashboard → Services
- **Important**: Removing a service is a **soft delete** (it becomes unavailable for new bookings, but existing bookings can still show it).

### 3) Staff
You can create staff members and assign them to a location.

- **Where**: Dashboard → Staff
- **What staff can do**:
  - Staff typically access a “My bookings” style view (staff portal).
- **Important**:
  - Removing staff is a **soft delete**.
  - Existing bookings can remain but may be **unassigned** from that staff member.
  - The current implementation behaves like **one location per staff member** (needs validation if multi-location is intended).

### 4) Bookings (manage appointments)
Bookings appear in your dashboard with customer details, service, time, status, and (optionally) staff assignment.

- **Where**: Dashboard → Bookings
- **Common actions**:
  - Assign or unassign a staff member
  - Reschedule
  - Change status (confirmed, paid, completed, cancelled, no-show)

### 5) Calendar view
The calendar is a weekly view showing bookings in time slots.

- **Where**: Dashboard → Calendar
- **If Google Calendar is connected**:
  - The calendar can display Google Calendar events and link them to bookings (exact “source of truth” behavior needs validation; see `docs/architecture.md`).

### 6) Holidays, off-days, and closures
You can control availability beyond normal opening hours:

- **Public holidays** (based on a chosen region), with overrides
- **Off-days** (full-day blocks), optionally scoped to one location
- **Closed hours** (block a specific time window on a day)

- **Where**: Dashboard → Holidays

### 7) Customer list (CRM-lite)
The system maintains a simple customer list based on confirmed bookings.

- **Where**: Dashboard → Customers
- **Capabilities**:
  - View customer booking history stats
  - Edit customer name/email/phone
  - Configure reminder preferences per customer
  - Send a manual email to a customer (email delivery depends on your email configuration)

### 8) Booking settings (breaks + automation)
There is a booking settings area where you can configure breaks and some automation-related items.

- **Where**: Dashboard → Bookings → Booking settings
- **Note**: The exact set of automations depends on your current build; see `docs/features.md` for implementation-based details.

### 9) Embed (website integration)
You can embed your booking page into your website via an iframe and customize basic theme settings.

- **Where**: Dashboard → Embed
- **What you get**:
  - Your booking URL (public): `/book/<your-salon-slug>`
  - An iframe snippet you can paste into your website
  - Theme controls (colors/text) and optional custom CSS for the embed container

## Appointment booking flow (what customers experience)
### Step-by-step
Customers book via your public booking page:

1. **Choose location** (skips if your salon has only one location)
2. **Choose service(s)** (the system supports selecting multiple services; total duration and price are summed)
3. **Pick a time slot**
4. **Enter details** (name/email/phone; optionally “save my info” for next time)
5. **Confirm**
   - Usually via an **email confirmation link**
   - Then, depending on payment settings, the customer is either:
     - Confirmed immediately (free / no payment), or
     - Taken to checkout (Stripe) and then sees a success page

### How the platform decides which slots are available (simplified)
Slots shown to customers are based on:
- Your location opening hours
- Your closures / off-days / public holidays (and overrides)
- Existing bookings (conflicts)
- Break times configured in booking settings
- A built-in gap/buffer between bookings (implementation uses a 15-minute buffer)
- Optional Google Calendar conflicts if used (especially when a specific staff member is selected)

## Notifications & reminders
### Booking emails
The platform sends booking-related emails (confirmation and status-related emails) via an email provider integration.

### Reminder emails
There is an automated reminder system that can send:
- A reminder the day before
- A reminder an hour before

These can be controlled at:
- **Organization level** (default)
- **Per-customer level** (override)

## Payments (if enabled)
If your system is configured for payments, customers can be redirected to an online checkout during booking.

- **Payment provider**: Stripe (requires configuration)
- **Outcome**:
  - Successful payment confirms the booking and leads to a “thank you” page.

## Plans / tiers (multi-location behavior)
The system contains tier behavior controlling how many locations an organization can have:
- Tier 1: 1 location
- Tier 2: up to 10 locations
- Tier 3: up to 100 locations

How a tier is assigned depends on your admin setup.

## Admin controls (for salon clients)
Salon owners typically can:
- Configure locations/opening hours
- Manage services and VAT rates
- Create and manage staff
- Manage bookings + calendar
- Configure holidays/off-days/closures
- Manage embed settings
- Configure reminder behavior (some controls per-customer exist)

## Typical day-to-day usage
- Check today’s bookings in **Calendar** and **Bookings**
- Assign staff to unassigned bookings
- Reschedule or cancel bookings as needed
- Add an off-day or closure if the salon becomes unavailable
- Add or update services/pricing as the menu changes
- Email a customer when required (follow-ups, clarifications)

## End-user journeys (by role)
### Salon owner / admin
- **Access**: Full dashboard navigation (locations, staff, services, bookings, calendar, holidays, customers, settings, embed).
- **Typical workflow**:
  - Configure salon setup (locations/hours, services, staff).
  - Publish booking link/embed.
  - Manage bookings daily via Bookings/Calendar.
  - Adjust availability using holidays/off-days/closures.
  - Monitor customers and manage reminder behavior.

### Staff member
- **Access**: Staff portal (“My bookings”) showing assigned bookings.
- **Typical workflow**:
  - Review upcoming appointments.
  - Check past bookings for reference.
- **Restrictions**: Generally does not manage locations/services/settings (enforced primarily via UI and expected RLS).

### Customer (booking an appointment)
- **Access**: Public booking page only (no dashboard account required).
- **Typical workflow**:
  - Choose location and service(s), pick a slot, enter contact details.
  - Confirm via email link.
  - Pay (if required) and receive confirmation.

### Super admin (SaaS operator) — if applicable
- **Access**: Admin panel in dashboard.
- **Typical workflow**:
  - Approve/reject new signups.
  - Create salons/owners, adjust tiers, manage accounts.

## Benefits for salon businesses
- Customers can self-book online via a shareable link or embed.
- Reduced admin time due to automated confirmation and reminders.
- More control over availability (holidays, off-days, closures).
- Optional payment collection and Google Calendar visibility.

## Key limitations / dependencies (based on current implementation)
- **Email delivery** requires correct provider configuration (Resend).
- **Payments** require Stripe configuration and are only available if enabled.
- **Google Calendar** behavior depends on OAuth setup and token state.
- Role enforcement is partly UI-driven; ensure backend policies are set correctly (see `docs/roles-and-permissions.md`).

## New salon setup checklist (practical)
1. Create your organization and sign in as the salon owner.
2. Add at least one **location** and define **opening hours**.
3. Add your **services** (durations + pricing, optional VAT).
4. Add **staff** and assign to a location.
5. Configure **holidays/off-days/closures** if relevant.
6. Configure **booking settings** (breaks/reminders) as needed.
7. Copy your **booking link** or the **embed iframe** into your website.
8. (Optional) Connect **Stripe** and **Google Calendar** if you use them.
