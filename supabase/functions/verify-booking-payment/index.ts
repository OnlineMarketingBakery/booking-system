import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
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
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { booking_id } = await req.json();
    if (!booking_id) throw new Error("booking_id is required");

    const { data: booking } = await supabaseClient
      .from("bookings")
      .select("*, staff(name), services(name, duration_minutes, price, currency), locations(name, address), organizations(name)")
      .eq("id", booking_id)
      .single();

    if (!booking) throw new Error("Booking not found");

    if (booking.status === "paid" || booking.status === "completed") {
      return new Response(
        JSON.stringify({ status: booking.status, paid: true, booking }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Try to verify via checkout session first (more reliable)
    if (booking.stripe_session_id) {
      const session = await stripe.checkout.sessions.retrieve(booking.stripe_session_id);
      
      if (session.payment_status === "paid") {
        // Update with payment intent ID if we didn't have it
        const updateData: Record<string, string> = { status: "paid" };
        if (session.payment_intent && !booking.stripe_payment_intent_id) {
          updateData.stripe_payment_intent_id = session.payment_intent as string;
        }
        
        await supabaseClient
          .from("bookings")
          .update(updateData)
          .eq("id", booking_id);

        // Send confirmation email
        try {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-booking-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
            body: JSON.stringify({ booking_id, type: "confirmation" }),
          });
        } catch (e) { console.error("Email send failed:", e); }

        // Sync to Google Calendar
        try {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-booking-to-gcal`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ booking_id }),
          });
        } catch (e) { console.error("GCal sync failed:", e); }

        return new Response(
          JSON.stringify({ status: "paid", paid: true, booking }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      return new Response(
        JSON.stringify({ status: booking.status, paid: false, payment_status: session.payment_status, booking }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Fallback: verify via payment intent
    if (booking.stripe_payment_intent_id) {
      const paymentIntent = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent_id);

      if (paymentIntent.status === "succeeded") {
        await supabaseClient
          .from("bookings")
          .update({ status: "paid" })
          .eq("id", booking_id);

        try {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-booking-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
            body: JSON.stringify({ booking_id, type: "confirmation" }),
          });
        } catch (e) { console.error("Email send failed:", e); }

        // Sync to Google Calendar
        try {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-booking-to-gcal`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ booking_id }),
          });
        } catch (e) { console.error("GCal sync failed:", e); }

        return new Response(
          JSON.stringify({ status: "paid", paid: true, booking }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      return new Response(
        JSON.stringify({ status: booking.status, paid: false, payment_status: paymentIntent.status, booking }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    return new Response(
      JSON.stringify({ status: booking.status, paid: false, booking }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[verify-booking-payment] ERROR:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
