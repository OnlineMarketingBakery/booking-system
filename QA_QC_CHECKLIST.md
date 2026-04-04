# Salonora — QA & QC checklist

**Who this is for:** Testers, salon owners checking a release, and anyone validating the product **without** needing to read code.

**How to use it:** Work top to bottom for a full release check, or jump to the sections that changed. Check every box only when you have **seen** the behavior yourself in the environment you are testing (for example staging or production).

**What you need:** A normal web browser, test email access, and (if your team uses them) three types of login: a **salon owner**, a **staff member**, and a **platform admin** account. Your team can create these for you.

---

## 1. General — every release

- [ ] The home / login page loads without a broken layout on a **phone**, a **tablet**, and a **computer** screen.
- [ ] Images and the Salonora branding look clear (not stretched or missing).
- [ ] After signing in, your **name** appears in the top bar of the dashboard.
- [ ] **Sign out** works and returns you to a state where you must sign in again to see the dashboard.
- [ ] Opening a **made-up address** on the site (for example a random path that does not exist) shows a friendly “page not found” message and a way back to the home page.
- [ ] If something fails (wrong password, missing information), the app shows a **clear message** in normal language, not a blank screen.

---

## 2. Login, sign-up, and password

### Sign in

- [ ] While the app checks an **existing session** (for example after refreshing the login page when you were already signed in), you briefly see a **loading state**, then either stay on login or go to the dashboard as expected—not a broken half-loaded screen.
- [ ] **Sign in** with a correct email and password opens the dashboard.
- [ ] **Wrong password** shows an error and does not open the dashboard.
- [ ] **Forgot password:** You can request a reset, see confirmation that an email may have been sent, and (using the link from email) set a **new password** and then sign in with it.
- [ ] **After a purchase (if your team uses it):** The welcome email link opens a **create your password** page; after you choose a password you are **signed in** to the dashboard (or see a clear error if the link expired).

### Sign up

- [ ] **Create account** with name, email, and password behaves as your team expects: either you are signed in right away, or you see a message that the account is **waiting for approval** (if your business uses approvals).
- [ ] Password rules match what the screen says (for example minimum length).
- [ ] The sign-up area mentions **Terms of Service** in line with your legal pages (your team confirms the wording is still correct).

### While logged in

- [ ] **Change password** (in dashboard settings) works when the new password and confirmation match, and shows an error when they do not or when the password is too short.

---

## 3. New salon setup (first-time owner)

- [ ] A new owner without a salon yet sees a **setup** flow to create the salon name and the **public booking link** piece (the short name used in the web address).
- [ ] After setup, the dashboard **overview** loads with charts or summaries (not an endless loading spinner).
- [ ] The **booking link** you were given opens the public booking page for that salon.

---

## 4. Public online booking (customer view)

Use the real booking link for a test salon (your team will provide it). Complete the flow as if you were a customer.

### Basics

- [ ] The page shows the **salon name** (and logo if the salon added one).
- [ ] **Step 1 — Location:** You can choose a location (if there is more than one). If there is only one, the flow still makes sense.
- [ ] **Step 2 — Services:** You can select one or more services. Prices and durations look correct.
- [ ] **Step 3 — Time:** You can pick a **date** and a **time** that makes sense. Times that should not be offered (for example when the salon is closed, on a holiday, or during a break you configured) do **not** appear as available—or the calendar clearly blocks those days.
- [ ] **Several staff at one location:** If the salon has **more than one** staff member, the **same time** can still be offered to new customers **until** each staff member already has someone booked for that time (for example with two staff, two different customers can book the same slot when nobody chose a specific staff member—or after one person chose staff A, another person can still book that time for staff B).
- [ ] **Step 4 — Details:** **Phone number** and **full name** are required; the form explains what is missing if you try to continue without them.
- [ ] Optional **email** field behaves as expected for your flows (some paths need email for confirmation or payment).
- [ ] **Save my information** (if shown): Turning it on/off does not break the form; after a successful booking, returning customers may see fewer steps—confirm with your team what should happen.

### After the customer submits

One or more of these can apply depending on price and settings—your team will tell you which to expect:

- [ ] **Free booking:** You see a **confirmation** on the same site with the appointment summary.
- [ ] **Email confirmation first:** You see a message that an email was sent; the email arrives; the **link in the email** completes the booking or takes you to payment as designed.
- [ ] **Paid booking:** You are sent to the **payment** screen; completing payment returns you to a **thank-you** page with the **correct date, time, service, staff (if any), and location**.
- [ ] **Payment cancelled:** If the customer abandons payment, they see a clear **“payment cancelled / not completed”** message and can try again from the booking page.
- [ ] **Release time from email:** If the product sends a link to **give up a held time** without paying, that link shows a clear success or explanation (for example already used or expired).

### Unhappy paths

- [ ] **Wrong or old booking link** (broken token, expired link) shows a clear error, not a blank page.
- [ ] **Invalid salon link** (wrong address) shows an appropriate “not found” or error state.

### Optional: booking page appearance

- [ ] If the salon changed **colors or text** in the embed / widget settings, the public booking page reflects those choices after saving.
- [ ] **Preview** of the widget design (if your team uses it) matches what customers see after you save.

---

## 5. Dashboard — salon owner (main menu)

The owner menu typically includes: Dashboard, Bookings (and Booking settings), Locations, Staff, Services, Calendar, Holidays, Embed, Customers, Settings. Confirm each item **opens the right page** and the page title matches the menu.

### Dashboard (overview)

- [ ] Numbers and charts look **reasonable** for your test data (upcoming bookings, revenue-style summaries if shown).
- [ ] **Recent bookings** list matches what you expect from test bookings.
- [ ] Links from the overview to other sections work.

### Bookings (list)

- [ ] All test appointments appear with **correct customer name, time, service, status, and location**.
- [ ] **Search** by customer name or email finds the right rows.
- [ ] **Filter by status** (pending, confirmed, paid, cancelled, etc.) works.
- [ ] You can **change status** where the product allows it, and the list updates.
- [ ] You can **assign or change staff** on a booking where allowed.
- [ ] **Reschedule** (if available): Choosing a new future date and time updates the booking; choosing a past time shows an error.

### Bookings → Booking settings

- [ ] **Break times:** You can add, edit, or remove break rules; saved rules still appear after refreshing the page. Public booking should **respect** these breaks (spot-check with a test time).
- [ ] **Reminder emails:** Switches for **day before** and **one hour before** save correctly and stay as set after reload.
- [ ] **Google Calendar:** **Connect** sends you through Google and returns with a success message; **Disconnect** works; **Sync existing bookings** runs and reports something sensible (or “nothing to sync” if appropriate).
- [ ] When Google Calendar is connected and the calendar shows a **salon** Google event that is **only in Google** (not linked to a row in the app yet), clicking it allows **saving as a salon booking** or **removing** it from Google. **Personal or other Google meetings** (not created by this salon’s sync) still appear for context but **do not** open that dialog when clicked.

### Locations

- [ ] You can **add**, **edit**, and **deactivate** locations as designed.
- [ ] Opening hours and related settings match what customers see when booking.

### Staff

- [ ] You can **add staff**, assign them to locations, and **invite** them if your flow uses invitations.
- [ ] Staff who should not receive bookings are **hidden** or inactive as designed.

### Services

- [ ] You can **create**, **edit**, and **remove** services; **price, duration, and tax/VAT choice** save correctly.
- [ ] Only **active** services appear on the public booking page (confirm with your team).

### Calendar

- [ ] The calendar shows bookings in the right **time slots** and **days**.
- [ ] On the week view, each appointment block’s **height and position** match its real start and end time (for example a 9:45–10:15 booking reaches into the next hour row instead of staying squeezed in the 9:00 row only).
- [ ] If **two or more bookings overlap in time** on the same day, they appear as **separate columns** next to each other (not one unreadable stack), and you can **open each** by clicking its own card.
- [ ] Moving or editing from the calendar (if supported) updates the booking list and vice versa.

### Holidays and closed days

- [ ] **Public holidays** for the chosen **country/region** appear logically on the calendar or booking flow.
- [ ] You can mark **extra closed days** or **exceptions**; customers cannot book when the business should be closed.
- [ ] **Date ranges** and **partial-day closures** (if you use them) behave as the salon expects.

### Embed (widget)

- [ ] The page shows the **correct embed code** and **booking URL** for this salon.
- [ ] **Copy** puts the code on the clipboard.
- [ ] **Saving design** (colors, headings, optional custom styling) updates the **live preview** and the real public page after save.
- [ ] **Reset to defaults** restores the original look.

### Customers

- [ ] Customer list shows people who have booked, with useful **contact info** and **booking counts**.
- [ ] **Per-customer reminder** settings (if present) save and persist after reload.
- [ ] **Send email** (if present): A test send completes or shows a clear error from the app.

### Settings (organization and account)

- [ ] **Account — change password** (see section 2).
- [ ] **Organization name** can be edited and saves; **slug** (URL part) displays correctly and matches the live booking link.
- [ ] **Payment connection** line (for example whether the salon is connected to take online payments) matches the real setup your team configured.
- [ ] **Default holiday region** saves and affects holiday behavior.
- [ ] **Remove staff** from here (if available): Confirm dialog appears; after removal, that person no longer appears for **new** bookings; existing appointments still show history as your team expects.
- [ ] **Tax / VAT rates:** Add, edit, remove, set **default**, and **disable percentage** where applicable; **Save** persists; services can use these rates.

---

## 6. Dashboard — staff member

Log in as a **staff** account (not the salon owner).

- [ ] The sidebar shows **only what staff should see** (typically their bookings view and settings if they have access—not the full owner menu).
- [ ] The home screen greets the staff member by **name** and shows **their salon name**.
- [ ] **Upcoming** and **past** appointments lists match assignments for that person.
- [ ] If the account is **not** linked to a staff profile, the user sees a clear message instead of someone else’s data.

---

## 7. Platform admin (super admin)

Log in with a **platform admin** account (your team provides this).

- [ ] The menu is **limited** to admin-appropriate items (for example admin panel and settings—not the full salon owner menu unless that is intentional for your product).
- [ ] **Pending sign-ups** (if used): You can **approve** or **reject**; approved users can sign in as owners; rejected users cannot access the dashboard inappropriately.
- [ ] **User and organization management** actions your team cares about (view, disable, delete) work and show confirmations or errors in plain language.
- [ ] Charts or statistics on the admin dashboard load without errors.
- [ ] **Plug&Pay sync (if used):** Running the sync behaves as your team expects and new buyers get the right **welcome** experience (no errors only visible in logs).
- [ ] **Plug&Pay webhook (if used):** After a test purchase on the connected product, the buyer receives the **create password** email (or your team sees a clear log if something failed).

---

## 8. Staff invitation (email link)

Without being logged in as the inviter, open an **invitation link** from email (test invite).

- [ ] Valid invite shows **which salon** invited you and **accept / decline** (or equivalent).
- [ ] **Accept** succeeds and shows a clear success message.
- [ ] **Decline** succeeds and shows a clear message.
- [ ] **Expired or already used** invite shows a clear message, not a technical error.

---

## 9. Emails (spot check with real inboxes)

Your team defines which emails must fire. Typical cases:

- [ ] **Booking confirmation** after a completed booking (free or paid).
- [ ] **Confirm booking** email when the customer must click before the slot is final.
- [ ] **Reminder** emails (day before / one hour before) when enabled—use a test booking at a safe time.
- [ ] **Password reset** email arrives and the link works.
- [ ] **Staff invite** email content and link work.
- [ ] **Welcome after purchase (if used):** Email explains next steps; the **create password** link matches your live site address and works once.

---

## 10. Embedding on another website (if you use it)

- [ ] Pasting the **iframe code** into a simple test page shows the booking widget **inside the frame**.
- [ ] The widget is **scrollable** and **usable** on mobile where relevant.
- [ ] If the widget does **not** appear, your team checks hosting settings—this checklist only confirms whether the live product allows embedding from a normal test page.

---

## 11. Security and privacy (non-technical checks)

- [ ] You cannot see **another salon’s bookings** while logged in to a different salon.
- [ ] After **sign out**, using the browser **back** button does not leave sensitive data visible without signing in again (best effort—try on a shared device).
- [ ] **Staff** cannot perform **owner-only** actions (for example deleting the organization) if your policy forbids it—verify with owner vs staff logins.

---

## 12. After each release — quick smoke test

- [ ] Owner can **sign in** and open **Bookings** and **Calendar**.
- [ ] A **new test booking** can be completed on the **public page**.
- [ ] **Thank-you** or **confirmation** screen shows correct details.

---

*Internal note for the development team: Whenever you ship a change that customers or salon users will see, add or adjust items in this checklist in the same plain language so QA always has an up-to-date guide.*

**Last reviewed against the app:** March 2026.
