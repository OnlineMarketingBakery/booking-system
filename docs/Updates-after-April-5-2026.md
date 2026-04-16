# Salonora — what changed (after 5 April 2026)

This note is for **anyone who wants a plain-language picture of recent work**: what was added, what was improved, and what customers or staff might notice. It is **not** a technical specification.

**Time period covered:** work done **from 6 April 2026 onward**, including what is in **git history** and additional **product fixes and polish** that may also exist in your **local** branch or workspace (not every small fix is always spelled out in a commit message).

**How this was assembled:** release commits after 5 April 2026 **plus** the same scope of changes reflected in the current codebase and implementation notes (booking logic, calendar behaviour, Google Calendar rules, staff defaults, UI, and database follow-ups).

---

## Summary in one paragraph

Recent work focused on **correct overlap detection for bookings** (real time ranges, several stylists at once, and fair auto-assignment), **more trustworthy calendar loading** when switching pages or refreshing, **smarter public booking** so the owner’s personal Google Calendar does not accidentally hide the whole salon when multiple stylists exist, **deeper Google Calendar integration** (time zone, optional per-stylist calendars, safer sync), **clearer dashboard and holiday settings**, a **post-setup guide** for new salons, and **cleaner visual design** (borders, grid, calendar header). Supporting database and policy work backs the new behaviour.

---

## Booking: overlaps, staff, and “who can take this slot?”

- **Real overlap instead of naive checks**  
  Availability now respects **full appointment length** on the timeline (start through end), not only a single clock tick. That closes gaps where two bookings could theoretically interfere with each other in a way the old logic did not always see.

- **Several stylists at one location**  
  When more than one person can work, the system considers **each stylist’s existing appointments** so a slot is only offered if **someone** can still take it. If the customer does **not** pick a stylist, the system can **suggest an assignee** in a balanced way (favouring whoever is less loaded in that window).

- **Checkout and confirmation**  
  The same “who is busy when” rules are applied when customers **confirm or pay**, so what they book matches what the salon calendar expects.

- **Behind the scenes**  
  A database routine returns **who is occupied for which time span** at a location (including short-lived holds where relevant). The public site and the server-side booking steps use **aligned** logic so behaviour stays consistent.

---

## Public booking page (customer-facing widget)

- **Pool booking vs owner’s Google Calendar**  
  The **owner’s linked Google Calendar** still reflects one person’s private busy time. The widget now treats that sensibly: when **several active stylists** work at the location, their **pooled** time slots are **not** all hidden just because the owner has a personal meeting. When there is **only one** stylist (or none), the owner calendar can still block the day as before, because there is no one else to serve the customer.

- **Simpler path when the salon assigns staff**  
  The flow was adjusted so customers are not asked to micromanage stylist choice in cases where the salon **assigns automatically** (aligned with the rules above).

---

## Calendar (salon dashboard): trust, refresh, and clarity

- **Refresh and navigation**  
  When you **open the calendar again** or data is **refetched**, the screen can show a **loading state until fresh data is ready** when there was already something on screen. That avoids a confusing moment where **the same appointment could appear twice** (for example salon booking plus a linked Google copy) or the view looked wrong for a split second.

- **Google reconciliation**  
  When Google sync **cancels or cleans up** linked events, the calendar booking list is **refreshed** so the dashboard does not disagree with reality.

- **Weekly view polish**  
  The **title, week range, “Create appointment”, and week navigation** are laid out more compactly on one row where space allows, with less wasted vertical space.

- **Google connection**  
  If Google is already linked, the **“Google connected” badge was removed** as redundant. If it is not linked, **connect** is still obvious.

- **Easier to read the grid**  
  Borders and lines use **more neutral greys** (less saturated blue). **Hour lines** are a bit stronger than **quarter-hour** guide lines so the day is easier to scan.

- **“Today” in the week**  
  The **current day** column is slightly easier to spot.

- **Appointments in the week grid**  
  Blocks use **sharper corners** and clearer **left-edge status** colour; **tint varies by stylist (and lightly by service)** so neighbouring appointments are easier to tell apart.

- **Location tabs**  
  The calendar stays organised **by location** with a clear tab strip where you have multiple locations.

---

## Google Calendar integration (salon side)

- **Organisation time zone**  
  Salons have a **single time zone** setting used for scheduling and for how times appear when talking to Google.

- **Optional per-stylist calendars**  
  Where enabled, a stylist’s bookings can sync to a **dedicated Google calendar** for that person instead of everything piling onto the owner’s primary calendar only.

- **Remembering which calendar an event belongs to**  
  Each booking can carry **which Google calendar** the synced event lives on, which matters for edits and deletes.

- **Fetch and sync behaviour**  
  Edge functions were updated so **fetching events**, **syncing bookings**, **deleting** remote events, and **staff calendar preparation** line up with the flags and fields above.

---

## Staff, defaults, and removing someone from the roster

- **Owner placeholder vs real stylists**  
  There is a clear **“salon / owner” placeholder** for cases where no person is chosen, while **real stylists** can be attached to **more than one location** where that makes sense.

- **Smarter default assignee**  
  When the salon has **real, active staff**, defaults were adjusted so the system **prefers an actual stylist** over the generic placeholder when that is appropriate (including a data tidy-up for existing organisations).

- **Staff screen**  
  Staff management was **improved** in line with locations, Google prep, and defaults.

- **Deactivating a stylist**  
  When someone is **removed from the active roster**, related behaviour updates **who future defaults point to** and can **reassign existing future bookings** that pointed at that person, so you do not end up with a long tail of mystery “unassigned” rows for the wrong reason.

---

## After signup: Post-setup wizard

- A **short guided step** after initial setup helps new salons complete basics without hunting through every settings page on day one.

---

## Settings, holidays, and navigation

- **Settings layout**  
  Settings areas were **restructured** so categories and subpages are easier to follow.

- **Public holidays list**  
  Each holiday is shown as **name first**, **full date underneath**, and a **plain sentence** next to the switch explaining whether **customers can book** that day. This replaces a dense “date — name” line that was easy to misread.

- **Sidebar order**  
  The main menu order was updated (for example **Dashboard → Calendar → Bookings → Locations → Staff → Services → Customers → Settings**) to match how salons tend to work.

---

## Integrations, sign-in, and account safety

- **Google OAuth and calendar listing**  
  Flows that support **connecting Google** and **choosing calendars** were updated alongside the integration above.

- **Integrations page**  
  Adjusted to fit the new layout and behaviour.

- **Account “danger zone”**  
  Reviewed as part of the same wave of changes.

- **Sign-in**  
  Minor **auth page** tweaks with the design refresh.

---

## Look and feel (design system)

- **Global borders**  
  Default borders were brought back to **neutral greys** instead of a strong brand-tinted outline everywhere, so forms and dashboards feel calmer.

- **Internal QA checklist**  
  A checklist document was updated so the team can **verify** the main flows after releases.

---

## Database and access (operations / self-hosted fixes)

- **Booking occupancy helper**  
  Supports the interval-based availability described above.

- **Organisation time zone and Google “layers”**  
  Adds the fields and public readout needed for correct times and optional per-stylist Google calendars.

- **Owner placeholder and locations**  
  Migrations support multi-location placeholders, default assignee links, and related booking data.

- **Prefer real staff as default**  
  A migration-style update can point default assignee at the **first real stylist** when the salon still had the generic placeholder selected.

- **Optional local SQL: RLS recursion fix**  
  If your project includes a small **standalone SQL fix** for “infinite recursion” in row-level security when policies check bookings, that is an **operational hardening** step: it stops certain policy chains from locking up when the database checks whether locations or services still have bookings. Your team applies this in the database environment where the issue appears.

---

## What recipients should *not* worry about

- Exact **file names**, **function names**, and **migration timestamps** are omitted on purpose; engineers can map this list to the repo.

- If something above does not appear in **your** deployed environment yet, it may still be on a **branch**, in **local** work, or waiting for **deployment**.

---

## Suggested subject line if you email this

**Salonora — product updates (after 5 April 2026)**

---

*This document combines git history from 6 April 2026 onward with the product-facing outcomes reflected in the current codebase and recent implementation work (including booking overlap, calendar refresh behaviour, pooled slots vs Google Calendar, staff defaults and reassignment, UI polish, and related database or policy fixes).*
