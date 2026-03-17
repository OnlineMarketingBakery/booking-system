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

    const name = full_name || "beste klant";

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
        <h1 style="color: #6b7280;">Je accountaanvraag is niet goedgekeurd</h1>
        <p>Hallo ${name},</p>
        <p>Bedankt voor je belangstelling. Na beoordeling kunnen we je accountaanvraag op dit moment niet goedkeuren.</p>
        <p>Als je denkt dat dit een vergissing is of vragen hebt, neem dan contact op met de klantenservice.</p>
        <p style="color: #6b7280; font-size: 14px;">Met vriendelijke groet,</p>
      </div>
    `;

    await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: [email],
      subject: "Je accountaanvraag is niet goedgekeurd",
      html,
    });

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[send-user-rejection-email]", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
