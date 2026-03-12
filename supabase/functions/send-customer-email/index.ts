/**
 * Send a one-off email to a customer from the dashboard (admin/salon owner).
 * Body: { organization_id, customer_email, customer_name?, subject?, message? }
 * If subject/message omitted, uses default. Verifies caller owns the org (or is staff).
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_SUBJECT = "A message from us";
const DEFAULT_MESSAGE = `Hi there,

We wanted to reach out and thank you for being a valued customer.

If you have any questions or would like to book another appointment, please don't hesitate to contact us.

Best regards`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const body = await req.json();
    const { organization_id, customer_email, customer_name, subject, message } = body;
    if (!organization_id || !customer_email) {
      return new Response(
        JSON.stringify({ error: "organization_id and customer_email are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: org, error: orgError } = await supabaseUser
      .from("organizations")
      .select("id, name")
      .eq("id", organization_id)
      .single();
    if (orgError || !org) {
      return new Response(
        JSON.stringify({ error: "Organization not found or access denied" }),
        { status: orgError?.code === "PGRST116" ? 404 : 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("RESEND_API_KEY is not set");
    const resend = new Resend(resendKey);
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@booking.salonora.eu";

    const subj = (subject && String(subject).trim()) || DEFAULT_SUBJECT.replace("us", org.name || "us");
    const msg = (message && String(message).trim()) || DEFAULT_MESSAGE;
    const name = (customer_name && String(customer_name).trim()) || "there";
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
        <h1 style="color: #3990f0; margin-bottom: 8px;">${subj}</h1>
        <p>Hi ${name},</p>
        <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0; white-space: pre-wrap;">${msg.replace(/\n/g, "<br>")}</div>
        <p style="color: #6b7280; font-size: 14px;">Best regards,<br>${org.name || "The team"}</p>
      </div>
    `;

    await resend.emails.send({
      from: `${org.name || "Salon"} <${fromEmail}>`,
      to: [customer_email],
      subject: subj,
      html,
    });

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[send-customer-email] ERROR:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
