import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { Building2, MapPin, Layers, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";

type AuditDetails = Record<string, unknown>;

function tierDisplayName(tier: string): string {
  const m = tier.match(/^tier_(\d+)$/i);
  if (m) return `Tier ${m[1]}`;
  return tier.replace(/_/g, " ");
}

function actorNote(details: AuditDetails): string | null {
  if (details.actor_uid_unresolved === true) {
    return "We couldn’t attach a user name to this entry (some admin or system updates don’t record it).";
  }
  return null;
}

function formatLocationUpdateBody(details: AuditDetails): ReactNode {
  const before = details.before as Record<string, unknown> | undefined;
  const after = details.after as Record<string, unknown> | undefined;
  const note = actorNote(details);
  if (!before || !after) {
    return note ? <p className="text-xs text-muted-foreground">{note}</p> : null;
  }
  const lines: string[] = [];
  if (before.name !== after.name) {
    lines.push(`Salon name is now “${after.name ?? "—"}”.`);
  }
  if (before.address !== after.address) {
    lines.push("Address was updated.");
  }
  if (before.phone !== after.phone) {
    lines.push("Phone number was updated.");
  }
  if (before.is_active !== after.is_active) {
    lines.push(after.is_active ? "Location is turned on for customers." : "Location is turned off for new bookings.");
  }
  if (lines.length === 0) {
    lines.push("Saved changes to this location.");
  }
  return (
    <div className="space-y-1.5">
      <ul className="list-disc pl-4 text-sm text-muted-foreground space-y-1">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {note ? <p className="text-xs text-muted-foreground pt-1 border-t border-border/50 mt-2">{note}</p> : null}
    </div>
  );
}

function entryVisual(action: string) {
  switch (action) {
    case "tier_changed":
      return { Icon: Layers, iconClass: "text-violet-600 dark:text-violet-400" };
    case "location_created":
      return { Icon: MapPin, iconClass: "text-emerald-600 dark:text-emerald-400" };
    case "location_updated":
      return { Icon: Building2, iconClass: "text-sky-600 dark:text-sky-400" };
    default:
      return { Icon: ClipboardList, iconClass: "text-muted-foreground" };
  }
}

function AuditEntryBody({
  action,
  details,
}: {
  action: string;
  details: AuditDetails | null;
}): ReactNode {
  const d = (details && typeof details === "object" ? details : {}) as AuditDetails;
  const note = actorNote(d);

  if (action === "tier_changed") {
    const from = d.from != null ? tierDisplayName(String(d.from)) : null;
    const to = d.to != null ? tierDisplayName(String(d.to)) : null;
    return (
      <div className="space-y-2">
        {(from || to) && (
          <p className="text-sm text-muted-foreground">
            {from && to ? (
              <>
                Your plan moved from <span className="font-medium text-foreground">{from}</span> to{" "}
                <span className="font-medium text-foreground">{to}</span>.
              </>
            ) : to ? (
              <>
                New plan level: <span className="font-medium text-foreground">{to}</span>.
              </>
            ) : from ? (
              <>
                Previous plan: <span className="font-medium text-foreground">{from}</span>.
              </>
            ) : null}
          </p>
        )}
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </div>
    );
  }

  if (action === "location_created") {
    const name = d.name != null ? String(d.name) : "New location";
    const active = d.is_active !== false;
    return (
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          {active ? "It’s active and can be used for appointments." : "It was added as inactive."}
        </p>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </div>
    );
  }

  if (action === "location_updated") {
    return formatLocationUpdateBody(d);
  }

  /* Fallback: readable key–value, no raw JSON */
  const entries = Object.entries(d).filter(([k]) => k !== "actor_uid_unresolved");
  if (entries.length === 0) {
    return note ? <p className="text-xs text-muted-foreground">{note}</p> : null;
  }
  return (
    <dl className="grid gap-1 text-sm">
      {entries.map(([key, val]) => (
        <div key={key} className="flex flex-wrap gap-x-2 gap-y-0.5">
          <dt className="text-muted-foreground capitalize shrink-0">{key.replace(/_/g, " ")}</dt>
          <dd className="text-foreground/90 break-words">
            {val !== null && typeof val === "object" ? JSON.stringify(val) : String(val)}
          </dd>
        </div>
      ))}
      {note ? <p className="text-xs text-muted-foreground col-span-full pt-1">{note}</p> : null}
    </dl>
  );
}

function entryHeadline(action: string, details: AuditDetails | null): string {
  const d = (details && typeof details === "object" ? details : {}) as AuditDetails;
  switch (action) {
    case "tier_changed":
      return "Plan tier updated";
    case "location_created":
      return d.name != null ? `Location “${String(d.name)}” added` : "New location added";
    case "location_updated":
      return d.after && typeof d.after === "object" && (d.after as { name?: string }).name != null
        ? `“${String((d.after as { name?: string }).name)}” updated`
        : "Location details updated";
    default:
      return String(action).replace(/_/g, " ");
  }
}

export default function AuditLogPage() {
  const { organization } = useOrganization();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["organization-audit-log", organization?.id],
    queryFn: async () => {
      if (!organization) return [];
      const { data, error } = await supabase
        .from("organization_audit_log")
        .select("id, action, entity_type, entity_id, details, created_at")
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organization,
  });

  if (!organization) {
    return (
      <Card>
        <CardContent className="py-8 text-muted-foreground">No organization found.</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Activity log</h2>
        <p className="text-sm text-muted-foreground mt-1">
          A simple history of changes to your plan level and locations. If something looks unclear, contact support with
          the date and description.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
          <CardDescription>Up to 100 most recent events</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing here yet. When your plan or locations change, a short note will appear in this list.
            </p>
          ) : (
            <ul className="space-y-4">
              {rows.map((r) => {
                const details = (r.details as AuditDetails | null) ?? null;
                const action = String(r.action);
                const { Icon, iconClass } = entryVisual(action);
                const headline = entryHeadline(action, details);
                return (
                  <li
                    key={r.id}
                    className="rounded-xl border border-border/80 bg-card px-4 py-3 shadow-sm"
                  >
                    <div className="flex gap-3">
                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/60",
                        )}
                        aria-hidden
                      >
                        <Icon className={cn("h-5 w-5", iconClass)} />
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                          <h3 className="text-sm font-semibold text-foreground leading-snug pr-2">{headline}</h3>
                          <time
                            className="text-xs text-muted-foreground tabular-nums shrink-0"
                            dateTime={r.created_at as string}
                          >
                            {format(new Date(r.created_at as string), "PPp")}
                          </time>
                        </div>
                        <AuditEntryBody action={action} details={details} />
                        {r.entity_id ? (
                          <details className="group text-xs">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground list-none [&::-webkit-details-marker]:hidden flex items-center gap-1">
                              <span className="underline underline-offset-2">Technical reference</span>
                              <span className="text-muted-foreground/70 group-open:rotate-90 transition-transform">›</span>
                            </summary>
                            <div className="mt-2 rounded-md bg-muted/40 px-2 py-1.5 font-mono text-[11px] text-muted-foreground break-all">
                              {r.entity_type} · {r.entity_id as string}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
