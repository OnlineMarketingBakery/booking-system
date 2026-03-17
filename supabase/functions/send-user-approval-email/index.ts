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
    if (!resendKey) throw new Error("RESEND_API_KEY is not set");

    const resend = new Resend(resendKey);
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@booking.salonora.eu";
    const fromName = Deno.env.get("RESEND_FROM_NAME") || "Salonora";
    const { email, full_name } = await req.json();
    if (!email) throw new Error("email is required");

    const appUrl = Deno.env.get("APP_URL") || "";
    const loginUrl = appUrl ? `${appUrl.replace(/\/$/, "")}` : "de inlogpagina";
    const name = full_name || "beste klant";

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
        <h1 style="color: #3990f0;">Je account is goedgekeurd</h1>
        <p>Hallo ${name},</p>
        <p>Een beheerder heeft je account goedgekeurd. Je kunt nu inloggen en het platform gebruiken.</p>
        ${appUrl ? `<p><a href="${loginUrl}" style="color: #3990f0;">Inloggen</a></p>` : "<p>Ga naar de app en log in met je e-mailadres en wachtwoord.</p>"}
        <p style="color: #6b7280; font-size: 14px;">Bedankt!</p>
      </div>
    `;

    await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: [email],
      subject: "Je account is goedgekeurd",
      html,
    });

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[send-user-approval-email]", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
