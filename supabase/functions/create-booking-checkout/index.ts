import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// UUID v4 regex
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\+\d\s\-\(\)]*$/;

function validateInput(body: Record<string, unknown>) {
  const errors: string[] = [];

  // Required UUIDs
  for (const field of ["organization_id", "location_id", "staff_id"]) {
    if (typeof body[field] !== "string" || !UUID_RE.test(body[field] as string)) {
      errors.push(`${field} must be a valid UUID`);
    }
  }

  // Service IDs
  const serviceIds: string[] = (body.service_ids as string[]) || (body.service_id ? [body.service_id as string] : []);
  if (serviceIds.length === 0) {
    errors.push("At least one service is required");
  } else if (serviceIds.length > 10) {
    errors.push("Maximum 10 services allowed per booking");
  } else {
    for (const id of serviceIds) {
      if (typeof id !== "string" || !UUID_RE.test(id)) {
        errors.push("Each service_id must be a valid UUID");
        break;
      }
    }
  }

  // Customer fields
  const name = body.customer_name;
  if (typeof name !== "string" || name.trim().length < 2 || name.length > 100) {
    errors.push("customer_name must be 2-100 characters");
  }

  const email = body.customer_email;
  if (typeof email !== "string" || !EMAIL_RE.test(email) || email.length > 255) {
    errors.push("customer_email must be a valid email (max 255 chars)");
  }

  if (body.customer_phone != null && body.customer_phone !== "") {
    const phone = body.customer_phone as string;
    if (typeof phone !== "string" || phone.length > 20 || !PHONE_RE.test(phone)) {
      errors.push("customer_phone must be max 20 chars, digits/spaces/dashes only");
    }
  }

  // start_time
  const startTime = body.start_time;
  if (typeof startTime !== "string") {
    errors.push("start_time is required");
  } else {
    const d = new Date(startTime);
    if (isNaN(d.getTime())) {
      errors.push("start_time must be a valid ISO date");
    } else if (d.getTime() < Date.now() - 5 * 60 * 1000) {
      errors.push("start_time must not be in the past");
    }
  }

  return { serviceIds, errors };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const stripe = stripeKey ? new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" }) : null;

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json();

    // --- Input validation ---
    const { serviceIds, errors } = validateInput(body);
    if (errors.length > 0) {
      return new Response(
        JSON.stringify({ error: "Validation failed", details: errors }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const {
      organization_id,
      location_id,
      staff_id,
      customer_name,
      customer_email,
      customer_phone,
      start_time,
    } = body;

    // Fetch all services and verify they exist and are active
    const { data: servicesData, error: servicesError } = await supabaseClient
      .from("services")
      .select("id, name, price, duration_minutes, currency")
      .in("id", serviceIds)
      .eq("is_active", true);
    if (servicesError || !servicesData || servicesData.length === 0) throw new Error("Services not found");
    if (servicesData.length !== serviceIds.length) throw new Error("One or more services are inactive or invalid");

    // Verify organization, location, and staff exist and are active
    const { data: org, error: orgError } = await supabaseClient
      .from("organizations")
      .select("name")
      .eq("id", organization_id)
      .single();
    if (orgError || !org) throw new Error("Organization not found");

    const { data: loc, error: locError } = await supabaseClient
      .from("locations")
      .select("id")
      .eq("id", location_id)
      .eq("is_active", true)
      .single();
    if (locError || !loc) throw new Error("Location not found or inactive");

    const { data: staffMember, error: staffError } = await supabaseClient
      .from("staff")
      .select("id")
      .eq("id", staff_id)
      .eq("is_active", true)
      .single();
    if (staffError || !staffMember) throw new Error("Staff member not found or inactive");

    // Create bookings sequentially (back-to-back)
    const bookingIds: string[] = [];
    let currentStart = new Date(start_time);

    for (const service of servicesData) {
      const duration = service.duration_minutes || 30;
      const endTime = new Date(currentStart.getTime() + duration * 60000);

      const { data: booking, error: bookingError } = await supabaseClient
        .from("bookings")
        .insert({
          organization_id,
          location_id,
          staff_id,
          service_id: service.id,
          customer_name: customer_name.trim(),
          customer_email: customer_email.trim().toLowerCase(),
          customer_phone: customer_phone?.trim() || null,
          start_time: currentStart.toISOString(),
          end_time: endTime.toISOString(),
          status: "pending",
        })
        .select()
        .single();
      if (bookingError) {
        console.error('[create-booking-checkout] Booking creation error:', bookingError);
        throw new Error('Booking creation failed. Please try again.');
      }

      bookingIds.push(booking.id);
      currentStart = endTime;
    }

    const totalPriceCents = servicesData.reduce(
      (sum, s) => sum + Math.round(Number(s.price) * 100),
      0
    );

    const currency = (servicesData[0] as any).currency || "usd";

    // Free path: zero price, or Stripe not configured — confirm booking and return success
    if (totalPriceCents <= 0 || !stripe) {
      for (const id of bookingIds) {
        await supabaseClient
          .from("bookings")
          .update({ status: "confirmed" })
          .eq("id", id);
      }

      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-booking-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
          body: JSON.stringify({ booking_id: bookingIds[0], type: "confirmation" }),
        });
      } catch (e) { console.error("Email send failed:", e); }

      for (const id of bookingIds) {
        try {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-booking-to-gcal`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ booking_id: id }),
          });
        } catch (e) { console.error("GCal sync failed:", e); }
      }

      return new Response(
        JSON.stringify({ free: true, booking_ids: bookingIds }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Stripe path: paid booking with Stripe configured
    const origin = req.headers.get("origin") || Deno.env.get("APP_URL") || "http://localhost:8080";
    const lineItems = servicesData.map((service) => ({
      price_data: {
        currency,
        product_data: {
          name: service.name,
          description: `${service.duration_minutes} min at ${org?.name || "salon"}`,
        },
        unit_amount: Math.round(Number(service.price) * 100),
      },
      quantity: 1,
    }));

    const session = await stripe.checkout.sessions.create({
      customer_email,
      line_items: lineItems,
      mode: "payment",
      success_url: `${origin}/book/success?booking_id=${bookingIds[0]}`,
      cancel_url: `${origin}/book/cancel?booking_id=${bookingIds[0]}`,
      metadata: {
        booking_ids: JSON.stringify(bookingIds),
        organization_id,
      },
    });

    for (const id of bookingIds) {
      const updateData: Record<string, string> = { stripe_session_id: session.id };
      if (session.payment_intent) {
        updateData.stripe_payment_intent_id = session.payment_intent as string;
      }
      await supabaseClient
        .from("bookings")
        .update(updateData)
        .eq("id", id);
    }

    return new Response(
      JSON.stringify({ url: session.url, booking_ids: bookingIds }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[create-booking-checkout] ERROR:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
