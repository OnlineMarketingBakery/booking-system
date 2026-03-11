/**
 * Cron-invoked: sends appointment reminder emails.
 * - Day before: bookings whose start_time is tomorrow (UTC date).
 * - 1 hour before: bookings whose start_time is in ~55–65 minutes.
 * Respects org-level and per-customer reminder settings.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function startOfDayUTC(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const cronSecret = req.headers.get("x-cron-secret");
  const expectedSecret = Deno.env.get("CRON_SECRET");
  if (expectedSecret && cronSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    const functionsUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

    const now = new Date();
    const sent: { booking_id: string; type: string }[] = [];

    // ---- Day before: bookings that start tomorrow (UTC) ----
    const tomorrowStart = startOfDayUTC(addDays(now, 1));
    const tomorrowEnd = startOfDayUTC(addDays(now, 2));
    const tomorrowStartStr = tomorrowStart.toISOString();
    const tomorrowEndStr = tomorrowEnd.toISOString();

    const { data: dayBeforeBookings } = await supabase
      .from("bookings")
      .select("id, organization_id, customer_email, organizations!inner(reminder_email_day_before)")
      .in("status", ["confirmed", "paid"])
      .gte("start_time", tomorrowStartStr)
      .lt("start_time", tomorrowEndStr);

    if (dayBeforeBookings?.length) {
      const { data: alreadySentDay } = await supabase
        .from("booking_reminder_sent")
        .select("booking_id")
        .eq("reminder_type", "day_before")
        .in("booking_id", dayBeforeBookings.map((b) => b.id));
      const sentDaySet = new Set((alreadySentDay ?? []).map((r) => r.booking_id));

      for (const b of dayBeforeBookings as any[]) {
        if (sentDaySet.has(b.id)) continue;
        const orgAllows = b.organizations?.reminder_email_day_before !== false;
        if (!orgAllows) continue;

        const { data: prefs } = await supabase
          .from("customer_reminder_preferences")
          .select("email_reminder_day_before")
          .eq("organization_id", b.organization_id)
          .eq("customer_email", b.customer_email)
          .maybeSingle();
        const customerAllows = prefs?.email_reminder_day_before !== false;
        if (!customerAllows) continue;

        const res = await fetch(`${functionsUrl}/send-booking-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ booking_id: b.id, type: "reminder" }),
        });
        if (!res.ok) {
          console.error("[send-booking-reminders] day_before failed:", b.id, await res.text());
          continue;
        }
        await supabase.from("booking_reminder_sent").insert({
          booking_id: b.id,
          reminder_type: "day_before",
        });
        sent.push({ booking_id: b.id, type: "day_before" });
      }
    }

    // ---- 1 hour before: bookings starting in 55–65 minutes ----
    const windowStart = new Date(now.getTime() + 55 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 65 * 60 * 1000);

    const { data: hourBeforeBookings } = await supabase
      .from("bookings")
      .select("id, organization_id, customer_email, organizations!inner(reminder_email_hour_before)")
      .in("status", ["confirmed", "paid"])
      .gte("start_time", windowStart.toISOString())
      .lte("start_time", windowEnd.toISOString());

    if (hourBeforeBookings?.length) {
      const { data: alreadySentHour } = await supabase
        .from("booking_reminder_sent")
        .select("booking_id")
        .eq("reminder_type", "hour_before")
        .in("booking_id", hourBeforeBookings.map((b) => b.id));
      const sentHourSet = new Set((alreadySentHour ?? []).map((r) => r.booking_id));

      for (const b of hourBeforeBookings as any[]) {
        if (sentHourSet.has(b.id)) continue;
        const orgAllows = b.organizations?.reminder_email_hour_before !== false;
        if (!orgAllows) continue;

        const { data: prefs } = await supabase
          .from("customer_reminder_preferences")
          .select("email_reminder_hour_before")
          .eq("organization_id", b.organization_id)
          .eq("customer_email", b.customer_email)
          .maybeSingle();
        const customerAllows = prefs?.email_reminder_hour_before !== false;
        if (!customerAllows) continue;

        const res = await fetch(`${functionsUrl}/send-booking-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ booking_id: b.id, type: "reminder" }),
        });
        if (!res.ok) {
          console.error("[send-booking-reminders] hour_before failed:", b.id, await res.text());
          continue;
        }
        await supabase.from("booking_reminder_sent").insert({
          booking_id: b.id,
          reminder_type: "hour_before",
        });
        sent.push({ booking_id: b.id, type: "hour_before" });
      }
    }

    return new Response(
      JSON.stringify({ success: true, sent: sent.length, details: sent }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[send-booking-reminders] ERROR:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
