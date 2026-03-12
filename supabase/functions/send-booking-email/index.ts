import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
      const { token, customer_email, customer_name, org_name, formatted_date, formatted_time, service_summary, confirm_url } = confirm_booking || {};
      if (!token || !customer_email || !confirm_url) throw new Error("confirm_booking requires token, customer_email, confirm_url");
      const subject = `Confirm your booking — ${org_name || "Your Salon"}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
          <h1 style="color: #3990f0; margin-bottom: 8px;">Confirm your booking</h1>
          <p>Hi ${customer_name || "there"},</p>
          <p>You requested an appointment. Please confirm it by clicking the button below.</p>
          ${formatted_date && formatted_time ? `<div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 4px 0;"><strong>📅 Date:</strong> ${formatted_date}</p>
            <p style="margin: 4px 0;"><strong>🕐 Time:</strong> ${formatted_time}</p>
            ${service_summary ? `<p style="margin: 4px 0;"><strong>✂️ Services:</strong> ${service_summary}</p>` : ""}
          </div>` : ""}
          <p style="margin: 24px 0;">
            <a href="${confirm_url}" style="display: inline-block; background: #3990f0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Confirm booking</a>
          </p>
          <p style="color: #6b7280; font-size: 14px;">This link expires in 24 hours. If you didn't request this, you can ignore this email.</p>
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
    const startTime = new Date(booking.start_time);
    const currencySymbols: Record<string, string> = { usd: "$", eur: "€", gbp: "£", cad: "C$", aud: "A$", jpy: "¥", inr: "₹", brl: "R$" };
    const symbol = currencySymbols[service?.currency || "eur"] || "€";

    const formattedDate = startTime.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const formattedTime = startTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    let subject = "";
    let heading = "";

    if (type === "confirmation") {
      subject = `Booking Confirmed — ${org?.name || "Your Salon"}`;
      heading = "Your Booking is Confirmed!";
    } else if (type === "reminder") {
      subject = `Reminder: Upcoming Appointment — ${org?.name || "Your Salon"}`;
      heading = "Appointment Reminder";
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
        <h1 style="color: #3990f0; margin-bottom: 8px;">${heading}</h1>
        <p>Hi ${booking.customer_name},</p>
        <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>📅 Date:</strong> ${formattedDate}</p>
          <p style="margin: 4px 0;"><strong>🕐 Time:</strong> ${formattedTime}</p>
          <p style="margin: 4px 0;"><strong>✂️ Service:</strong> ${service?.name} (${service?.duration_minutes} min)</p>
          <p style="margin: 4px 0;"><strong>💰 Price:</strong> ${symbol}${Number(service?.price || 0).toFixed(2)}</p>
          <p style="margin: 4px 0;"><strong>👤 Staff:</strong> ${staff?.name || "TBD"}</p>
          <p style="margin: 4px 0;"><strong>📍 Location:</strong> ${location?.name || ""}${location?.address ? ` — ${location.address}` : ""}</p>
        </div>
        <p style="color: #6b7280; font-size: 14px;">If you need to cancel or reschedule, please contact us directly.</p>
        <p style="color: #6b7280; font-size: 14px;">Thank you for choosing ${org?.name || "us"}!</p>
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
