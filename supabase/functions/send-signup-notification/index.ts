import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-runtime",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const adminEmail = Deno.env.get("ADMIN_EMAIL");
    if (!resendKey) {
      console.error("[send-signup-notification] RESEND_API_KEY is not set. Add it in Supabase Dashboard → Edge Functions → Secrets.");
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY is not set. Add it in Supabase → Edge Functions → Secrets." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!adminEmail) {
      console.error("[send-signup-notification] ADMIN_EMAIL is not set. Add it in Supabase Dashboard → Edge Functions → Secrets.");
      return new Response(
        JSON.stringify({ error: "ADMIN_EMAIL is not set. Add it in Supabase → Edge Functions → Secrets." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resend = new Resend(resendKey);
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@booking.salonora.eu";
    const fromName = Deno.env.get("RESEND_FROM_NAME") || "Salonora";
    const { email, full_name, user_id } = await req.json();
    if (!email) throw new Error("email is required");

    const appUrl = Deno.env.get("APP_URL") || "the app";
    const dashboardUrl = `${appUrl.replace(/\/$/, "")}/dashboard`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
        <h1 style="color: #3990f0;">Nieuwe aanmeldingsaanvraag</h1>
        <p>Een gebruiker heeft een account aangevraagd en wacht op goedkeuring.</p>
        <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Naam:</strong> ${full_name || "—"}</p>
          <p style="margin: 4px 0;"><strong>E-mail:</strong> ${email}</p>
          <p style="margin: 4px 0;"><strong>Gebruikers-ID:</strong> ${user_id || "—"}</p>
        </div>
        <p>Ga naar het beheerdersdashboard om deze aanvraag goed te keuren of af te wijzen.</p>
        <p><a href="${dashboardUrl}" style="color: #3990f0;">Dashboard openen</a></p>
      </div>
    `;

    await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: [adminEmail],
      subject: "Nieuwe aanmeldingsaanvraag — goedkeuring vereist",
      html,
    });

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[send-signup-notification]", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
