import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  let token: string | null = url.searchParams.get("token");
  let body: { token?: string; action?: string } = {};

  if (req.method === "POST") {
    body = await req.json().catch(() => ({}));
    if (!token) token = body.token ?? null;
  }

  if (!token) {
    return new Response(JSON.stringify({ error: "Token required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const { data: inv, error: fetchErr } = await serviceClient
    .from("staff_invitations")
    .select("id, status, email, expires_at, organization_id, organizations(name)")
    .eq("token", token)
    .maybeSingle();

  if (fetchErr || !inv) {
    return new Response(JSON.stringify({ error: "Invitation not found or invalid" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const orgName = (inv as any).organizations?.name ?? "the team";
  const expiresAt = (inv as any).expires_at ? new Date((inv as any).expires_at).toISOString() : null;
  const isExpired = expiresAt ? new Date(expiresAt) < new Date() : false;

  // GET: return invitation details for the page (org name, expiry, status)
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({
        org_name: orgName,
        expires_at: expiresAt,
        status: inv.status,
        expired: isExpired,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  }

  // POST: accept or reject
  const action = body.action === "reject" ? "reject" : "accept";

  if (inv.status !== "pending") {
    return new Response(
      JSON.stringify({ success: true, already: true, status: inv.status }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  }

  if (isExpired) {
    await serviceClient
      .from("staff_invitations")
      .update({ status: "expired" })
      .eq("id", inv.id);
    return new Response(JSON.stringify({ error: "This invitation has expired" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (action === "reject") {
    const { error: updateErr } = await serviceClient
      .from("staff_invitations")
      .update({ status: "rejected", rejected_at: new Date().toISOString() })
      .eq("id", inv.id);
    if (updateErr) {
      return new Response(JSON.stringify({ error: "Failed to reject" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } else {
    const { error: updateErr } = await serviceClient
      .from("staff_invitations")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", inv.id);
    if (updateErr) {
      return new Response(JSON.stringify({ error: "Failed to accept" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Notify the inviter (org owner)
  const { data: org } = await serviceClient
    .from("organizations")
    .select("owner_id")
    .eq("id", inv.organization_id)
    .single();

  let ownerEmail: string | null = null;
  if (org?.owner_id) {
    const { data: profile } = await serviceClient.from("profiles").select("email").eq("id", org.owner_id).maybeSingle();
    if (profile?.email) ownerEmail = profile.email;
    if (!ownerEmail) {
      const { data: appUser } = await serviceClient.from("app_users").select("email").eq("id", org.owner_id).maybeSingle();
      if (appUser?.email) ownerEmail = appUser.email;
    }
  }

  if (ownerEmail) {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@booking.salonora.eu";
    if (resendKey) {
      try {
        const resend = new Resend(resendKey);
        const subject = action === "accept"
          ? `${inv.email} accepted your staff invitation`
          : `${inv.email} declined your staff invitation`;
        const verb = action === "accept" ? "accepted" : "declined";
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #3990f0;">Staff invitation ${action === "accept" ? "accepted" : "declined"}</h2>
            <p><strong>${inv.email}</strong> ${verb} your invitation to join <strong>${orgName}</strong> as staff.</p>
            ${action === "accept" ? "<p>You can now add them as staff from your dashboard under Staff → Add Staff.</p>" : ""}
          </div>
        `;
        await resend.emails.send({
          from: `${orgName} <${fromEmail}>`,
          to: [ownerEmail],
          subject,
          html,
        });
      } catch (e) {
        console.error("[accept-staff-invite] Failed to send owner notification:", e);
      }
    }
  }

  return new Response(
    JSON.stringify({ success: true, action }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
  );
});
