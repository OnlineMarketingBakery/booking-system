import { useState, useMemo } from "react";
import { usePlanDefinitions } from "@/hooks/usePlanDefinitions";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useSpamProtection } from "@/hooks/useSpamProtection";
import { SpamProtectionFields } from "@/components/SpamProtectionFields";
import { Loader2, Plus, Pencil, Trash2, Save, CheckSquare } from "lucide-react";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { tierLabelWithLimit, type OrgTier } from "@/lib/tierLimits";

/** One row = one salon (organization) created by a tenant, with owner info */
interface SalonRow {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  owner_name: string | null;
  owner_email: string | null;
  tier: OrgTier | null;
  locations_count: number;
  created_at: string;
}

export default function SuperAdminAccounts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { validateSpamProtection, SpamProtectionFieldsProps } = useSpamProtection();
  const { invokeFunction } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [editSalon, setEditSalon] = useState<SalonRow | null>(null);
  const [pendingTierChanges, setPendingTierChanges] = useState<Record<string, OrgTier>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTierOpen, setBulkTierOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const { data: planDefinitions = [] } = usePlanDefinitions();
  const tierSelectLabels = useMemo(
    () => ({
      tier_1: tierLabelWithLimit("tier_1", planDefinitions),
      tier_2: tierLabelWithLimit("tier_2", planDefinitions),
      tier_3: tierLabelWithLimit("tier_3", planDefinitions),
    }),
    [planDefinitions]
  );

  const { data: approvedUserIds = [] } = useQuery({
    queryKey: ["admin-approved-user-ids"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_users")
        .select("id")
        .eq("approval_status", "approved");
      if (error) throw error;
      return (data || []).map((r) => r.id);
    },
  });

  const { data: salons = [], isLoading } = useQuery({
    queryKey: ["admin-salons", approvedUserIds],
    queryFn: async () => {
      const approvedSet = new Set(approvedUserIds);
      const [rolesRes, superAdminRes, orgsRes, locationsRes] = await Promise.all([
        supabase.from("user_roles").select("user_id").eq("role", "salon_owner"),
        supabase.from("user_roles").select("user_id").eq("role", "super_admin"),
        supabase.from("organizations").select("id, name, slug, owner_id, tier, created_at"),
        supabase.from("locations").select("organization_id"),
      ]);
      if (rolesRes.error) throw rolesRes.error;
      if (superAdminRes.error) throw superAdminRes.error;
      if (orgsRes.error) throw orgsRes.error;
      if (locationsRes.error) throw locationsRes.error;

      const superAdminIds = new Set((superAdminRes.data || []).map((r) => r.user_id));
      const ownerIds = (rolesRes.data || [])
        .map((r) => r.user_id)
        .filter((id) => !superAdminIds.has(id) && approvedSet.has(id));
      const ownerIdSet = new Set(ownerIds);
      const orgs = (orgsRes.data || []).filter((o) => ownerIdSet.has(o.owner_id));
      if (orgs.length === 0) return [];

      const locationCountByOrg: Record<string, number> = {};
      (locationsRes.data || []).forEach((loc: { organization_id: string }) => {
        locationCountByOrg[loc.organization_id] = (locationCountByOrg[loc.organization_id] ?? 0) + 1;
      });

      const ownerIdsFromOrgs = [...new Set(orgs.map((o) => o.owner_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ownerIdsFromOrgs);

      const profileMap = new Map((profiles || []).map((p) => [p.id, p]));

      return orgs.map((org) => {
        const profile = profileMap.get(org.owner_id);
        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          owner_id: org.owner_id,
          owner_name: profile?.full_name ?? null,
          owner_email: profile?.email ?? null,
          tier: (org.tier as OrgTier) ?? null,
          locations_count: locationCountByOrg[org.id] ?? 0,
          created_at: org.created_at,
        };
      }) as SalonRow[];
    },
    enabled: approvedUserIds.length >= 0,
  });

  const allSelected = salons.length > 0 && selectedIds.size === salons.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < salons.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(salons.map((s) => s.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedSalons = useMemo(
    () => salons.filter((s) => selectedIds.has(s.id)),
    [salons, selectedIds]
  );

  const createOwner = useMutation({
    mutationFn: async (vals: { name: string; email: string; password: string; orgName: string; tier: OrgTier }) => {
      return await invokeFunction("create-salon-owner", vals);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-salons"] });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-platform-stats"] });
      setAddOpen(false);
      toast({ title: "Salon created" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create salon", description: err.message, variant: "destructive" });
    },
  });

  const saveTierChanges = useMutation({
    mutationFn: async (changes: Record<string, OrgTier>) => {
      const updates = Object.entries(changes).map(([orgId, tier]) =>
        supabase.from("organizations").update({ tier }).eq("id", orgId)
      );
      const results = await Promise.all(updates);
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-salons"] });
      setPendingTierChanges({});
      toast({ title: "Tier changes saved" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to save changes", description: err.message, variant: "destructive" });
    },
  });

  const bulkChangeTier = useMutation({
    mutationFn: async (tier: OrgTier) => {
      const orgIds = selectedSalons.map((s) => s.id);
      if (orgIds.length === 0) throw new Error("No salons selected");
      const updates = orgIds.map((orgId) =>
        supabase.from("organizations").update({ tier }).eq("id", orgId)
      );
      const results = await Promise.all(updates);
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-salons"] });
      setSelectedIds(new Set());
      setBulkTierOpen(false);
      toast({ title: `Tier updated for ${selectedSalons.length} salon(s)` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update tiers", description: err.message, variant: "destructive" });
    },
  });

  const bulkDelete = useMutation({
    mutationFn: async () => {
      const orgIds = Array.from(selectedIds);
      for (const orgId of orgIds) {
        const res = await invokeFunction("admin-delete-organization", { organization_id: orgId });
        if (res?.error) throw new Error(res.error);
      }
      const ownerIds = [...new Set(selectedSalons.map((s) => s.owner_id))];
      for (const userId of ownerIds) {
        await invokeFunction("admin-delete-user", { user_id: userId });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-salons"] });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-platform-stats"] });
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      toast({ title: `${selectedSalons.length} salon(s) deleted` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    },
  });

  const hasPendingChanges = Object.keys(pendingTierChanges).length > 0;

  const updateSalon = useMutation({
    mutationFn: async (payload: {
      orgId: string;
      orgName: string;
      tier: OrgTier;
      ownerId: string;
      ownerName: string;
    }) => {
      const { error: orgErr } = await supabase
        .from("organizations")
        .update({ name: payload.orgName, tier: payload.tier })
        .eq("id", payload.orgId);
      if (orgErr) throw orgErr;

      await invokeFunction("admin-update-user", {
        user_id: payload.ownerId,
        full_name: payload.ownerName,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-salons"] });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setEditSalon(null);
      toast({ title: "Salon and owner updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  const deleteSalon = useMutation({
    mutationFn: async (salon: SalonRow) => {
      const res = await invokeFunction("admin-delete-organization", { organization_id: salon.id });
      if (res?.error) throw new Error(res.error);
      await invokeFunction("admin-delete-user", { user_id: salon.owner_id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-salons"] });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-platform-stats"] });
      toast({ title: "Salon deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    },
  });

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!validateSpamProtection(form)) {
      toast({ title: "Please wait a moment", description: "Then try again.", variant: "destructive" });
      return;
    }
    createOwner.mutate({
      name: form.get("name") as string,
      email: form.get("email") as string,
      password: form.get("password") as string,
      orgName: form.get("orgName") as string,
      tier: (form.get("tier") as OrgTier) || "tier_1",
    });
  };

  const handleEdit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editSalon) return;
    const form = new FormData(e.currentTarget);
    if (!validateSpamProtection(form)) {
      toast({ title: "Please wait a moment", description: "Then try again.", variant: "destructive" });
      return;
    }
    updateSalon.mutate({
      orgId: editSalon.id,
      orgName: (form.get("orgName") as string) || editSalon.name,
      tier: (form.get("tier") as OrgTier) || "tier_1",
      ownerId: editSalon.owner_id,
      ownerName: (form.get("ownerName") as string) || editSalon.owner_name || "",
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Tenant Salons</h2>
          <p className="text-sm text-muted-foreground">Manage salons created by tenants: change tier, edit details, or reset owner password</p>
        </div>
        <div className="flex gap-2">
          {hasPendingChanges && (
            <Button
              variant="default"
              onClick={() => saveTierChanges.mutate(pendingTierChanges)}
              disabled={saveTierChanges.isPending}
            >
              {saveTierChanges.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Changes ({Object.keys(pendingTierChanges).length})
            </Button>
          )}
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" />Add Salon</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Salon</DialogTitle></DialogHeader>
              <form onSubmit={handleAdd} className="space-y-4">
                <SpamProtectionFields {...SpamProtectionFieldsProps} />
                <div className="space-y-2">
                  <Label>Full Name</Label>
                  <Input name="name" required placeholder="Jane Doe" />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input name="email" type="email" required placeholder="jane@example.com" />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input name="password" type="password" required minLength={6} placeholder="Min 6 characters" />
                </div>
                <div className="space-y-2">
                  <Label>Organization Name</Label>
                  <Input name="orgName" required placeholder="Glamour Salon" />
                </div>
                <div className="space-y-2">
                  <Label>Tier</Label>
                  <Select name="tier" defaultValue="tier_1">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tier_1">{tierSelectLabels.tier_1}</SelectItem>
                      <SelectItem value="tier_2">{tierSelectLabels.tier_2}</SelectItem>
                      <SelectItem value="tier_3">{tierSelectLabels.tier_3}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" className="w-full" disabled={createOwner.isPending}>
                  {createOwner.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Owner
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Bulk Action Toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          <CheckSquare className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">
            {selectedIds.size} salon{selectedIds.size > 1 ? "s" : ""} selected
          </span>
          <div className="ml-auto flex gap-2">
            <Dialog open={bulkTierOpen} onOpenChange={setBulkTierOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">Change Tier</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Change Tier for {selectedIds.size} Salon{selectedIds.size > 1 ? "s" : ""}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    This will update the subscription tier for all selected salons.
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {(["tier_1", "tier_2", "tier_3"] as OrgTier[]).map((tier) => (
                      <Button
                        key={tier}
                        variant="outline"
                        className="justify-start h-auto py-3"
                        disabled={bulkChangeTier.isPending}
                        onClick={() => bulkChangeTier.mutate(tier)}
                      >
                        {bulkChangeTier.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        {tierSelectLabels[tier]}
                      </Button>
                    ))}
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* Bulk Delete */}
            <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Selected
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {selectedIds.size} salon{selectedIds.size > 1 ? "s" : ""}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the selected salons and their owner accounts. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => bulkDelete.mutate()}
                    disabled={bulkDelete.isPending}
                  >
                    {bulkDelete.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Delete {selectedIds.size} Salon{selectedIds.size > 1 ? "s" : ""}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Edit Salon & Owner Dialog */}
      <Dialog open={!!editSalon} onOpenChange={(open) => !open && setEditSalon(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Salon & Owner</DialogTitle></DialogHeader>
          {editSalon && (
            <form onSubmit={handleEdit} className="space-y-4">
              <SpamProtectionFields {...SpamProtectionFieldsProps} />
              <div className="space-y-2">
                <Label>Salon Name</Label>
                <Input name="orgName" required defaultValue={editSalon.name} />
              </div>
              <div className="space-y-2">
                <Label>Tier</Label>
                <Select name="tier" defaultValue={editSalon.tier || "tier_1"}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tier_1">{tierSelectLabels.tier_1}</SelectItem>
                    <SelectItem value="tier_2">{tierSelectLabels.tier_2}</SelectItem>
                    <SelectItem value="tier_3">{tierSelectLabels.tier_3}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="border-t pt-4 space-y-2">
                <Label className="text-muted-foreground">Owner details</Label>
                <div className="space-y-2">
                  <Label>Owner Name</Label>
                  <Input name="ownerName" required defaultValue={editSalon.owner_name || ""} />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={editSalon.owner_email || ""} disabled className="opacity-60" />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={updateSalon.isPending}>
                {updateSalon.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                    className={someSelected ? "data-[state=unchecked]:bg-primary/20" : ""}
                  />
                </TableHead>
                <TableHead>Salon</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Locations</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {salons.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                    No salons yet
                  </TableCell>
                </TableRow>
              ) : (
                salons.map((s) => (
                  <TableRow key={s.id} className={cn(selectedIds.has(s.id) && "bg-primary/5")}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(s.id)}
                        onCheckedChange={() => toggleSelect(s.id)}
                        aria-label={`Select ${s.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-muted-foreground">{s.owner_name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{s.owner_email || "—"}</TableCell>
                    <TableCell>
                      <Select
                        value={pendingTierChanges[s.id] ?? s.tier ?? "tier_1"}
                        onValueChange={(val) => {
                          setPendingTierChanges((prev) => {
                            const next = { ...prev };
                            if (val === (s.tier ?? "tier_1")) {
                              delete next[s.id];
                            } else {
                              next[s.id] = val as OrgTier;
                            }
                            return next;
                          });
                        }}
                      >
                        <SelectTrigger className={cn("w-[150px] h-8 text-xs", pendingTierChanges[s.id] && "border-primary ring-1 ring-primary")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="tier_1">Tier 1</SelectItem>
                          <SelectItem value="tier_2">Tier 2</SelectItem>
                          <SelectItem value="tier_3">Tier 3</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.locations_count}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(s.created_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditSalon(s)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete salon?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete {s.name} and the owner account ({s.owner_email}).
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => deleteSalon.mutate(s)}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
