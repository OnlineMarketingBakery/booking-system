import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Fallback for older bookings without customer_slot_* (stored display fields). */
function bookingEmailTimezone(): string {
  return Deno.env.get("BOOKING_EMAIL_TIMEZONE") || "Europe/Amsterdam";
}

function formatDateNlFromYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  return utc.toLocaleDateString("nl-NL", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatBookingLocalDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const tz = bookingEmailTimezone();
  const date = d.toLocaleDateString("nl-NL", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: tz,
  });
  const time = d.toLocaleTimeString("nl-NL", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
  return { date, time };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("RESEND_API_KEY is not set");

    const resend = new Resend(resendKey);

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { booking_id, type = "confirmation", confirm_booking } = await req.json();

    // Type: confirm_booking — email asking customer to confirm their booking (no booking_id)
    if (type === "confirm_booking") {
      const {
        token,
        customer_email,
        customer_name,
        org_name,
        formatted_date,
        formatted_time,
        service_summary,
        confirm_url,
        release_hold_url,
      } = confirm_booking || {};
      if (!token || !customer_email || !confirm_url) throw new Error("confirm_booking requires token, customer_email, confirm_url");
      const subject = `Bevestig je reservering — ${org_name || "Je salon"}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
          <h1 style="color: #3990f0; margin-bottom: 8px;">Bevestig je reservering</h1>
          <p>Hallo ${customer_name || "beste klant"},</p>
          <p>Je hebt een afspraak aangevraagd. Bevestig deze door op de onderstaande knop te klikken.</p>
          ${formatted_date && formatted_time ? `<div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 4px 0;"><strong>📅 Datum:</strong> ${formatted_date}</p>
            <p style="margin: 4px 0;"><strong>🕐 Tijd:</strong> ${formatted_time}</p>
            ${service_summary ? `<p style="margin: 4px 0;"><strong>✂️ Diensten:</strong> ${service_summary}</p>` : ""}
          </div>` : ""}
          <p style="margin: 24px 0;">
            <a href="${confirm_url}" style="display: inline-block; background: #3990f0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Reservering bevestigen</a>
          </p>
          ${release_hold_url ? `<p style="margin: 16px 0; font-size: 14px;">
            <a href="${release_hold_url}" style="color: #6b7280;">Toch geen afspraak? Annuleer deze tijdsreservering</a>
          </p>` : ""}
          <p style="color: #6b7280; font-size: 14px;">Deze link verloopt over 24 uur. Als je dit niet hebt aangevraagd, kun je deze e-mail negeren.</p>
        </div>
      `;
      const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@booking.salonora.eu";
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

    // Fetch booking with related data
    const { data: booking, error } = await supabaseClient
      .from("bookings")
      .select("*, staff(name), services(name, duration_minutes, price, currency), locations(name, address), organizations(name)")
      .eq("id", booking_id)
      .single();
    if (error || !booking) throw new Error("Booking not found");

    const service = (booking as any).services;
    const staff = (booking as any).staff;
    const location = (booking as any).locations;
    const org = (booking as any).organizations;
    const currencySymbols: Record<string, string> = { usd: "$", eur: "€", gbp: "£", cad: "C$", aud: "A$", jpy: "¥", inr: "₹", brl: "R$" };
    const symbol = currencySymbols[service?.currency || "eur"] || "€";

    const slotDate = (booking as { customer_slot_date?: string | null }).customer_slot_date;
    const slotTime = (booking as { customer_slot_time?: string | null }).customer_slot_time;
    let formattedDate: string;
    let formattedTime: string;
    if (slotDate && slotTime) {
      formattedDate = formatDateNlFromYmd(slotDate);
      formattedTime = slotTime;
    } else {
      const fm = formatBookingLocalDateTime(booking.start_time as string);
      formattedDate = fm.date;
      formattedTime = fm.time;
    }

    let subject = "";
    let heading = "";

    if (type === "confirmation") {
      subject = `Reservering bevestigd — ${org?.name || "Je salon"}`;
      heading = "Je reservering is bevestigd!";
    } else if (type === "reminder") {
      subject = `Herinnering: komende afspraak — ${org?.name || "Je salon"}`;
      heading = "Afspraakherinnering";
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
        <h1 style="color: #3990f0; margin-bottom: 8px;">${heading}</h1>
        <p>Hallo ${booking.customer_name},</p>
        <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>📅 Datum:</strong> ${formattedDate}</p>
          <p style="margin: 4px 0;"><strong>🕐 Tijd:</strong> ${formattedTime}</p>
          <p style="margin: 4px 0;"><strong>✂️ Behandeling:</strong> ${service?.name} (${service?.duration_minutes} min)</p>
          <p style="margin: 4px 0;"><strong>💰 Prijs:</strong> ${symbol}${Number(service?.price || 0).toFixed(2)}</p>
          <p style="margin: 4px 0;"><strong>👤 Medewerker:</strong> ${staff?.name || "Nog niet bekend"}</p>
          <p style="margin: 4px 0;"><strong>📍 Locatie:</strong> ${location?.name || ""}${location?.address ? ` — ${location.address}` : ""}</p>
        </div>
        <p style="color: #6b7280; font-size: 14px;">Als je moet annuleren of verzetten, neem dan rechtstreeks contact met ons op.</p>
        <p style="color: #6b7280; font-size: 14px;">Bedankt dat je voor ${org?.name || "ons"} hebt gekozen!</p>
      </div>
    `;

    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@booking.salonora.eu";
    const emailResult = await resend.emails.send({
      from: `${org?.name || "Salonora"} <${fromEmail}>`,
      to: [booking.customer_email],
      subject,
      html,
    });

    console.log("Email sent:", emailResult);

    return new Response(
      JSON.stringify({ success: true, id: emailResult.data?.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[send-booking-email] ERROR:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
