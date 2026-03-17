import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import Holidays from "npm:date-holidays@3.26.9";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\+\d\s\-\(\)]*$/;

function validateInput(body: Record<string, unknown>) {
  const errors: string[] = [];
  for (const field of ["organization_id", "location_id"]) {
    if (typeof body[field] !== "string" || !UUID_RE.test(body[field] as string)) errors.push(`${field} must be a valid UUID`);
  }
  const staffId = body.staff_id;
  const hasStaffId = staffId !== undefined && staffId !== null && staffId !== "";
  if (hasStaffId && (typeof staffId !== "string" || !UUID_RE.test(staffId))) errors.push("staff_id must be a valid UUID when provided");

  const serviceIds: string[] = (body.service_ids as string[]) || (body.service_id ? [body.service_id as string] : []);
  if (serviceIds.length === 0) errors.push("At least one service is required");
  else if (serviceIds.length > 10) errors.push("Maximum 10 services allowed per booking");
  else for (const id of serviceIds) {
    if (typeof id !== "string" || !UUID_RE.test(id)) { errors.push("Each service_id must be a valid UUID"); break; }
  }

  const name = body.customer_name;
  if (typeof name !== "string" || name.trim().length < 2 || name.length > 100) errors.push("customer_name must be 2-100 characters");
  const email = body.customer_email;
  if (typeof email !== "string" || !EMAIL_RE.test(email) || email.length > 255) errors.push("customer_email must be a valid email (max 255 chars)");
  if (body.customer_phone != null && body.customer_phone !== "") {
    const phone = body.customer_phone as string;
    if (typeof phone !== "string" || phone.length > 20 || !PHONE_RE.test(phone)) errors.push("customer_phone must be max 20 chars");
  }
  const startTime = body.start_time;
  if (typeof startTime !== "string") errors.push("start_time is required");
  else {
    const d = new Date(startTime);
    if (isNaN(d.getTime())) errors.push("start_time must be a valid ISO date");
    else if (d.getTime() < Date.now() - 5 * 60 * 1000) errors.push("start_time must not be in the past");
  }
  return { serviceIds, errors };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json();
    const { errors } = validateInput(body);
    if (errors.length > 0) {
      return new Response(
        JSON.stringify({ error: "Validation failed", details: errors }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const organization_id = body.organization_id as string;
    const customer_email = (body.customer_email as string).trim().toLowerCase();
    const save_my_info = !!body.save_my_info;
    const start_time = body.start_time as string;

    // Reject if booking date is an off day (holiday or custom)
    if (start_time) {
      const startDate = new Date(start_time);
      const dateStr = startDate.toISOString().slice(0, 10);
      const year = startDate.getFullYear();

      const { data: orgRow } = await supabase
        .from("organizations")
        .select("holiday_region")
        .eq("id", organization_id)
        .single();
      const region = (body.region as string) || (orgRow as { holiday_region?: string } | null)?.holiday_region || "NL";

      const location_id = body.location_id as string;
      const { data: customOff = [] } = await supabase
        .from("organization_off_days")
        .select("id")
        .eq("organization_id", organization_id)
        .eq("date", dateStr)
        .or(`location_id.is.null,location_id.eq.${location_id}`);
      if (customOff.length > 0) {
        return new Response(
          JSON.stringify({ error: "This date is not available for booking (closed)." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }

      const { data: overrides = [] } = await supabase
        .from("organization_holiday_overrides")
        .select("is_working_day")
        .eq("organization_id", organization_id)
        .eq("date", dateStr);
      const isWorkingOverride = overrides.some((r: { is_working_day: boolean }) => r.is_working_day);

      const hd = new Holidays(region);
      const holidays = hd.getHolidays(year) || [];
      const holidayDates = new Set(
        (holidays as { date?: string; start?: Date }[]).map((h) => {
          if (typeof h.date === "string") return h.date.slice(0, 10);
          if (h.start instanceof Date) return h.start.toISOString().slice(0, 10);
          return "";
        }).filter(Boolean)
      );
      if (holidayDates.has(dateStr) && !isWorkingOverride) {
        return new Response(
          JSON.stringify({ error: "This date is a public holiday and not available for booking." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }
    }

    // Returning customer: already confirmed once → forward to create-booking-checkout
    const { data: existing } = await supabase
      .from("confirmed_booking_customers")
      .select("id")
      .eq("organization_id", organization_id)
      .eq("customer_email", customer_email)
      .eq("has_confirmed_once", true)
      .maybeSingle();

    if (existing) {
      const checkoutBody = { ...body };
      delete checkoutBody.save_my_info;
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/create-booking-checkout`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify(checkoutBody),
      });
      const data = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: res.status });
      }
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }

    // New customer: store pending and send confirm email
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const payload = {
      organization_id: body.organization_id,
      location_id: body.location_id,
      staff_id: body.staff_id ?? null,
      service_ids: body.service_ids,
      customer_name: (body.customer_name as string).trim(),
      customer_email,
      customer_phone: (body.customer_phone as string)?.trim() || null,
      start_time: body.start_time,
      region: body.region ?? null,
    };

    const { error: insertErr } = await supabase
      .from("pending_booking_confirmations")
      .insert({ token, organization_id, payload, save_my_info, expires_at: expiresAt });
    if (insertErr) throw new Error("Failed to create pending confirmation: " + insertErr.message);

    const { data: org } = await supabase.from("organizations").select("name").eq("id", organization_id).single();
    const { data: services } = await supabase.from("services").select("name").in("id", payload.service_ids);
    const service_summary = services?.map((s: { name: string }) => s.name).join(", ") || "";

    const appUrl = Deno.env.get("APP_URL") || req.headers.get("origin") || "http://localhost:8080";
    const confirmUrl = `${appUrl}/book/confirm?token=${token}`;
    const startTime = new Date(payload.start_time);

    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-booking-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
      body: JSON.stringify({
        type: "confirm_booking",
        confirm_booking: {
          token,
          customer_email,
          customer_name: payload.customer_name,
          org_name: org?.name || "Salonora",
          formatted_date: startTime.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
          formatted_time: startTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
          service_summary,
          confirm_url: confirmUrl,
        },
      }),
    });

    return new Response(
      JSON.stringify({ confirm_sent: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[request-booking-confirmation] ERROR:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
