# Email confirmation + “Save my information” – implementation snippets

Use this as a checklist. The feature is already implemented in the repo; these snippets are for reference or re-implementation.

---

## 1. Database migration

**File:** `supabase/migrations/20260311180000_booking_confirmation_flow.sql`

```sql
-- Pending booking confirmations: store payload and token until customer clicks email link
CREATE TABLE IF NOT EXISTS pending_booking_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  save_my_info boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_booking_confirmations_token ON pending_booking_confirmations(token);
CREATE INDEX IF NOT EXISTS idx_pending_booking_confirmations_expires ON pending_booking_confirmations(expires_at) WHERE used_at IS NULL;

-- Customers who have confirmed at least once via email; returning customers can skip confirmation
CREATE TABLE IF NOT EXISTS confirmed_booking_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_email text NOT NULL,
  customer_name text,
  customer_phone text,
  has_confirmed_once boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, customer_email)
);

CREATE INDEX IF NOT EXISTS idx_confirmed_booking_customers_org_email ON confirmed_booking_customers(organization_id, customer_email);

-- RLS: only edge functions (service role) should access these tables
ALTER TABLE pending_booking_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE confirmed_booking_customers ENABLE ROW LEVEL SECURITY;
```

**Action:** Run this migration in Supabase (SQL Editor or `supabase db push`).

---

## 2. Edge function: `request-booking-confirmation`

**Path:** `supabase/functions/request-booking-confirmation/index.ts`

- Full file is in the repo.
- **Behavior:** Validates body (same as create-booking-checkout + `save_my_info`). If customer exists in `confirmed_booking_customers` with `has_confirmed_once = true`, forwards to `create-booking-checkout` and returns its response. Otherwise inserts into `pending_booking_confirmations`, sends “Confirm your booking” email via `send-booking-email`, returns `{ confirm_sent: true }`.

**Deploy:**  
`supabase functions deploy request-booking-confirmation`

---

## 3. Edge function: `confirm-booking-by-token`

**Path:** `supabase/functions/confirm-booking-by-token/index.ts`

- Full file is in the repo.
- **Behavior:** Accepts `token` (body or query). Loads pending row, checks not used and not expired. Calls `create-booking-checkout` with stored payload. On success: upserts `confirmed_booking_customers` (and saves name/phone when `save_my_info` was true), sets `used_at` on pending, returns create-booking-checkout response.

**Deploy:**  
`supabase functions deploy confirm-booking-by-token`

---

## 4. Edge function: `send-booking-email` – add `confirm_booking` type

**File:** `supabase/functions/send-booking-email/index.ts`

**Change:** After parsing the request body, handle `type === "confirm_booking"` before the existing `booking_id` logic.

Replace:

```ts
const { booking_id, type = "confirmation" } = await req.json();
if (!booking_id) throw new Error("booking_id is required");
```

with:

```ts
const { booking_id, type = "confirmation", confirm_booking } = await req.json();

// Type: confirm_booking — email asking customer to confirm their booking (no booking_id)
if (type === "confirm_booking") {
  const { token, customer_email, customer_name, org_name, formatted_date, formatted_time, service_summary, confirm_url } = confirm_booking || {};
  if (!token || !customer_email || !confirm_url) throw new Error("confirm_booking requires token, customer_email, confirm_url");
  const subject = `Confirm your booking — ${org_name || "Your Salon"}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
      <h1 style="color: #7c3aed; margin-bottom: 8px;">Confirm your booking</h1>
      <p>Hi ${customer_name || "there"},</p>
      <p>You requested an appointment. Please confirm it by clicking the button below.</p>
      ${formatted_date && formatted_time ? `<div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 4px 0;"><strong>📅 Date:</strong> ${formatted_date}</p>
        <p style="margin: 4px 0;"><strong>🕐 Time:</strong> ${formatted_time}</p>
        ${service_summary ? `<p style="margin: 4px 0;"><strong>✂️ Services:</strong> ${service_summary}</p>` : ""}
      </div>` : ""}
      <p style="margin: 24px 0;">
        <a href="${confirm_url}" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Confirm booking</a>
      </p>
      <p style="color: #6b7280; font-size: 14px;">This link expires in 24 hours. If you didn't request this, you can ignore this email.</p>
    </div>
  `;
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@boeking.salonora.eu";
  await resend.emails.send({
    from: `${org_name || "Salonora"} <${fromEmail}>`,
    to: [customer_email],
    subject,
    html,
  });
  return new Response(
    JSON.stringify({ success: true }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
  );
}

if (!booking_id) throw new Error("booking_id is required");
```

**Deploy:**  
`supabase functions deploy send-booking-email`

---

## 5. Frontend: `BookingPage.tsx`

### 5a. Step type

```ts
type Step = "location" | "service" | "time" | "details" | "confirmed" | "confirm_email_sent";
```

### 5b. State for checkbox

```ts
const [saveMyInfo, setSaveMyInfo] = useState(false);
```

### 5c. Submit: call `request-booking-confirmation` and handle `confirm_sent`

In `handleBook`, replace the `supabase.functions.invoke("create-booking-checkout", ...)` block with:

```ts
const { data, error } = await supabase.functions.invoke(
  "request-booking-confirmation",
  {
    body: {
      organization_id: org!.id,
      location_id: selectedLocation,
      ...(selectedStaff ? { staff_id: selectedStaff } : {}),
      service_ids: selectedServices,
      customer_name: `${(form.get("firstName") as string)?.trim() ?? ""} ${(form.get("lastName") as string)?.trim() ?? ""}`.trim(),
      customer_email: form.get("email") as string,
      customer_phone: form.get("phone") as string,
      start_time: startTime.toISOString(),
      save_my_info: saveMyInfo,
    },
  },
);
if (error) throw error;

if (data.confirm_sent) {
  setStep("confirm_email_sent");
  return;
}

if (data.free) {
  setStep("confirmed");
  return;
}

if (data.url) {
  window.location.href = data.url;
}
```

### 5d. “Check your email” screen

Add after the `step === "confirmed"` block:

```tsx
if (step === "confirm_email_sent") {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md text-center">
        <CardContent className="py-12 space-y-4">
          <Calendar className="mx-auto h-16 w-16 text-primary" />
          <h2 className="text-2xl font-bold">Check your email</h2>
          <p className="text-muted-foreground">
            We've sent you a link to confirm your booking. Click the link in the email to complete your appointment. The link expires in 24 hours.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

### 5e. Checkbox in the form (e.g. after Phone, before Summary)

```tsx
<div className="flex items-center space-x-2">
  <Checkbox
    id="saveMyInfo"
    checked={saveMyInfo}
    onCheckedChange={(c) => setSaveMyInfo(!!c)}
    className="!shadow-none"
  />
  <Label htmlFor="saveMyInfo" className="text-sm font-normal cursor-pointer">
    Save my information for the next time I make an appointment
  </Label>
</div>
```

---

## 6. New page: `ConfirmBookingPage.tsx`

**File:** `src/pages/ConfirmBookingPage.tsx`

- Full file is in the repo.
- **Behavior:** Reads `token` from `?token=`, calls `confirm-booking-by-token`. On success: if `data.free` and `data.booking_ids[0]` → navigate to `/book/success?booking_id=...`; if `data.url` → redirect to Stripe. On error, show message and “Go back”.

---

## 7. Route in `App.tsx`

**Import:**

```ts
import ConfirmBookingPage from "./pages/ConfirmBookingPage";
```

**Route (e.g. after `/book/success`):**

```tsx
<Route path="/book/confirm" element={<ConfirmBookingPage />} />
```

---

## 8. Environment / deploy checklist

1. **Supabase**
   - Run migration `20260311180000_booking_confirmation_flow.sql`.
   - Deploy: `request-booking-confirmation`, `confirm-booking-by-token`, `send-booking-email`.
   - Ensure `APP_URL` is set for confirm links (e.g. production URL).

2. **Resend**
   - `RESEND_API_KEY` and `RESEND_FROM_EMAIL` already used by `send-booking-email`; no extra config for confirm email.

3. **Frontend**
   - Build and deploy so `/book/confirm` is served (e.g. same app as `/book/:slug`).

---

## Flow summary

| Who                | Action                    | Result                                                                 |
|--------------------|---------------------------|------------------------------------------------------------------------|
| New customer       | Clicks “Book Now”         | No booking yet → email “Confirm your booking” → “Check your email” UI. |
| New customer       | Clicks link in email      | `ConfirmBookingPage` → create booking → success or Stripe.              |
| Returning customer| Clicks “Book Now”         | Same as before: direct booking (free or Stripe).                        |
| “Save my information” checked on first confirm | After confirming via email | Name/phone stored; next time same email = returning, no confirm email. |
