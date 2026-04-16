import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// PBKDF2 password hashing (matches auth-custom)
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256
  );
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(derived)));
  return `pbkdf2:100000:${saltB64}:${hashB64}`;
}

async function createAppUser(
  admin: any,
  email: string,
  password: string,
  fullName: string
): Promise<{ id: string; created: boolean }> {
  // Check if already exists
  const { data: existing } = await admin
    .from("app_users")
    .select("id")
    .eq("email", email.toLowerCase().trim())
    .maybeSingle();

  if (existing) return { id: existing.id, created: false };

  const passwordHash = await hashPassword(password);
  const { data: newUser, error } = await admin
    .from("app_users")
    .insert({ email: email.toLowerCase().trim(), password_hash: passwordHash, full_name: fullName })
    .select("id")
    .single();
  if (error) throw error;

  // Create profile
  await admin.from("profiles").insert({ id: newUser.id, email: email.toLowerCase().trim(), full_name: fullName });

  return { id: newUser.id, created: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const results: string[] = [];

    // 1. Super Admin
    const sa = await createAppUser(admin, "superadmin@glowbook.test", "SuperAdmin123!", "Platform Admin");
    const { error: saRoleErr } = await admin.from("user_roles").upsert({ user_id: sa.id, role: "super_admin" }, { onConflict: "user_id,role" });
    results.push(sa.created
      ? `Super Admin created: superadmin@glowbook.test / SuperAdmin123! (role: ${saRoleErr ? saRoleErr.message : 'ok'})`
      : `Super Admin already exists (id: ${sa.id}, role: ${saRoleErr ? saRoleErr.message : 'ok'})`);

    // 2. Salon Owner 1
    const owner1 = await createOwnerWithData(admin, {
      email: "jane@glamoursalon.test", password: "Owner123!", fullName: "Jane Smith",
      orgName: "Glamour Salon", orgSlug: "glamour-salon",
      staffNames: ["Emily Rose", "Carlos Vega"],
      serviceNames: [
        { name: "Haircut", price: 45, duration: 30 },
        { name: "Hair Coloring", price: 120, duration: 90 },
        { name: "Blowout", price: 35, duration: 25 },
      ],
      locationName: "Downtown Studio", locationAddress: "123 Main St, Suite 4",
    });
    results.push(...owner1);

    // 3. Salon Owner 2
    const owner2 = await createOwnerWithData(admin, {
      email: "mike@zenbeauty.test", password: "Owner123!", fullName: "Mike Johnson",
      orgName: "Zen Beauty Bar", orgSlug: "zen-beauty",
      staffNames: ["Aisha Patel", "Tom Nguyen", "Lily Chen"],
      serviceNames: [
        { name: "Facial Treatment", price: 80, duration: 60 },
        { name: "Manicure", price: 30, duration: 30 },
        { name: "Pedicure", price: 40, duration: 45 },
        { name: "Waxing", price: 25, duration: 20 },
      ],
      locationName: "Zen Studio", locationAddress: "456 Oak Ave",
    });
    results.push(...owner2);

    // 4. Salon Owner 3 (no org - to test onboarding)
    const o3 = await createAppUser(admin, "sarah@newowner.test", "Owner123!", "Sarah Williams");
    await admin.from("user_roles").upsert({ user_id: o3.id, role: "salon_owner" }, { onConflict: "user_id,role" });
    results.push(o3.created
      ? "Salon Owner (no org): sarah@newowner.test / Owner123!"
      : "Salon Owner (no org) already exists (role ensured)");

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

interface OwnerConfig {
  email: string; password: string; fullName: string;
  orgName: string; orgSlug: string;
  staffNames: string[];
  serviceNames: { name: string; price: number; duration: number }[];
  locationName: string; locationAddress: string;
}

async function createOwnerWithData(admin: any, cfg: OwnerConfig): Promise<string[]> {
  const results: string[] = [];
  const owner = await createAppUser(admin, cfg.email, cfg.password, cfg.fullName);

  // Assign salon_owner role (always ensure)
  await admin.from("user_roles").upsert({ user_id: owner.id, role: "salon_owner" }, { onConflict: "user_id,role" });

  if (!owner.created) {
    results.push(`Owner ${cfg.email} already exists (role ensured), skipping org creation`);
    return results;
  }

  // Create org
  const { data: orgId, error: orgErr } = await admin.rpc("create_organization_with_role", {
    _name: cfg.orgName, _slug: cfg.orgSlug, _owner_id: owner.id,
  });
  if (orgErr) throw orgErr;

  // Location
  const { data: location, error: locErr } = await admin
    .from("locations")
    .insert({ name: cfg.locationName, address: cfg.locationAddress, organization_id: orgId })
    .select("id").single();
  if (locErr) throw locErr;

  // Services
  const { data: services, error: svcErr } = await admin
    .from("services")
    .insert(cfg.serviceNames.map((s) => ({
      name: s.name, price: s.price, duration_minutes: s.duration, organization_id: orgId,
    })))
    .select("id, name");
  if (svcErr) throw svcErr;

  // Staff
  const { data: staffRecords, error: staffErr } = await admin
    .from("staff")
    .insert(cfg.staffNames.map((name) => ({
      name, organization_id: orgId,
      email: `${name.toLowerCase().replace(/\s/g, ".")}@${cfg.orgSlug}.test`,
    })))
    .select("id, name");
  if (staffErr) throw staffErr;

  // Assign staff to location
  await admin.from("staff_locations").insert(
    staffRecords.map((s: any) => ({ staff_id: s.id, location_id: location.id }))
  );

  await admin
    .from("organizations")
    .update({ owner_default_staff_id: staffRecords[0].id as string })
    .eq("id", orgId as string);

  // Bookings
  const now = new Date();
  const statuses = ["confirmed", "completed", "paid", "pending", "cancelled"];
  const bookings = [];
  for (let i = 0; i < 8; i++) {
    const staff = staffRecords[i % staffRecords.length];
    const service = services[i % services.length];
    const startTime = new Date(now);
    startTime.setDate(startTime.getDate() + (-7 + i * 2));
    startTime.setHours(10 + (i % 6), 0, 0, 0);
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + (cfg.serviceNames[i % cfg.serviceNames.length]?.duration || 30));

    bookings.push({
      organization_id: orgId, location_id: location.id,
      staff_id: staff.id, service_id: service.id,
      start_time: startTime.toISOString(), end_time: endTime.toISOString(),
      customer_name: ["Alice Brown", "Bob Davis", "Carol Evans", "Dan Foster", "Eve Garcia", "Frank Hill", "Grace Irwin", "Henry Jones"][i],
      customer_email: `customer${i + 1}@example.com`,
      customer_phone: `555-010${i}`,
      status: statuses[i % statuses.length],
    });
  }
  await admin.from("bookings").insert(bookings);

  results.push(`Owner: ${cfg.email} / ${cfg.password} → ${cfg.orgName} (${staffRecords.length} staff, ${services.length} services, ${bookings.length} bookings)`);
  return results;
}
