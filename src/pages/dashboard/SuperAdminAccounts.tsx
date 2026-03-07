import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
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

type OrgTier = "tier_1" | "tier_2" | "tier_3";

const TIER_LABELS: Record<OrgTier, string> = {
  tier_1: "Tier 1 (1 location)",
  tier_2: "Tier 2 (10 locations)",
  tier_3: "Tier 3 (100 locations)",
};

interface OwnerRow {
  id: string;
  full_name: string | null;
  email: string | null;
  created_at: string;
  organization_id: string | null;
  organization_name: string | null;
  tier: OrgTier | null;
}

export default function SuperAdminAccounts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { invokeFunction } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [editOwner, setEditOwner] = useState<OwnerRow | null>(null);
  const [pendingTierChanges, setPendingTierChanges] = useState<Record<string, OrgTier>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTierOpen, setBulkTierOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const { data: owners = [], isLoading } = useQuery({
    queryKey: ["admin-salon-owners"],
    queryFn: async () => {
      const { data: roles, error: rolesErr } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "salon_owner");
      if (rolesErr) throw rolesErr;

      const ownerIds = (roles || []).map((r) => r.user_id);
      if (ownerIds.length === 0) return [];

      const [profilesRes, orgsRes] = await Promise.all([
        supabase.from("profiles").select("*").in("id", ownerIds),
        supabase.from("organizations").select("id, name, owner_id, tier"),
      ]);
      if (profilesRes.error) throw profilesRes.error;

      const orgs = orgsRes.data || [];

      return (profilesRes.data || []).map((p) => {
        const org = orgs.find((o) => o.owner_id === p.id);
        return {
          id: p.id,
          full_name: p.full_name,
          email: p.email,
          created_at: p.created_at,
          organization_id: org?.id || null,
          organization_name: org?.name || null,
          tier: (org?.tier as OrgTier) || null,
        };
      }) as OwnerRow[];
    },
  });

  const allSelected = owners.length > 0 && selectedIds.size === owners.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < owners.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(owners.map((o) => o.id)));
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

  const selectedOwners = useMemo(
    () => owners.filter((o) => selectedIds.has(o.id)),
    [owners, selectedIds]
  );

  // Create salon owner via edge function
  const createOwner = useMutation({
    mutationFn: async (vals: { name: string; email: string; password: string; orgName: string; tier: OrgTier }) => {
      return await invokeFunction("create-salon-owner", vals);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-salon-owners"] });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-platform-stats"] });
      setAddOpen(false);
      toast({ title: "Salon owner created" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create owner", description: err.message, variant: "destructive" });
    },
  });

  // Batch update tiers
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
      queryClient.invalidateQueries({ queryKey: ["admin-salon-owners"] });
      setPendingTierChanges({});
      toast({ title: "All changes saved successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to save changes", description: err.message, variant: "destructive" });
    },
  });

  // Bulk change tier
  const bulkChangeTier = useMutation({
    mutationFn: async (tier: OrgTier) => {
      const orgIds = selectedOwners
        .filter((o) => o.organization_id)
        .map((o) => o.organization_id!);
      if (orgIds.length === 0) throw new Error("No organizations to update");
      const updates = orgIds.map((orgId) =>
        supabase.from("organizations").update({ tier }).eq("id", orgId)
      );
      const results = await Promise.all(updates);
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-salon-owners"] });
      setSelectedIds(new Set());
      setBulkTierOpen(false);
      toast({ title: `Tier updated for ${selectedOwners.length} owner(s)` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update tiers", description: err.message, variant: "destructive" });
    },
  });

  // Bulk delete
  const bulkDelete = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selectedIds);
      const results = await Promise.all(
        ids.map((id) => invokeFunction("admin-delete-user", { user_id: id }))
      );
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-salon-owners"] });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-platform-stats"] });
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      toast({ title: `${selectedIds.size} owner(s) deleted` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    },
  });

  const hasPendingChanges = Object.keys(pendingTierChanges).length > 0;

  // Update owner profile
  const updateOwner = useMutation({
    mutationFn: async ({ userId, name, orgId, orgName, tier }: { userId: string; name: string; orgId: string | null; orgName: string; tier: OrgTier }) => {
      const { error: profileErr } = await supabase
        .from("profiles")
        .update({ full_name: name })
        .eq("id", userId);
      if (profileErr) throw profileErr;

      if (orgId) {
        const { error: orgErr } = await supabase
          .from("organizations")
          .update({ name: orgName, tier })
          .eq("id", orgId);
        if (orgErr) throw orgErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-salon-owners"] });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setEditOwner(null);
      toast({ title: "Owner updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  // Delete owner
  const deleteOwner = useMutation({
    mutationFn: async (userId: string) => {
      await invokeFunction("admin-delete-user", { user_id: userId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-salon-owners"] });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-platform-stats"] });
      toast({ title: "Owner deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    },
  });

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
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
    if (!editOwner) return;
    const form = new FormData(e.currentTarget);
    updateOwner.mutate({
      userId: editOwner.id,
      name: form.get("name") as string,
      orgId: editOwner.organization_id,
      orgName: form.get("orgName") as string,
      tier: (form.get("tier") as OrgTier) || "tier_1",
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
          <h2 className="text-lg font-semibold">Salon Owner Accounts</h2>
          <p className="text-sm text-muted-foreground">Add, edit, or remove salon owners and assign tiers</p>
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
              <Button><Plus className="mr-2 h-4 w-4" />Add Owner</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Salon Owner</DialogTitle></DialogHeader>
              <form onSubmit={handleAdd} className="space-y-4">
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
                      <SelectItem value="tier_1">{TIER_LABELS.tier_1}</SelectItem>
                      <SelectItem value="tier_2">{TIER_LABELS.tier_2}</SelectItem>
                      <SelectItem value="tier_3">{TIER_LABELS.tier_3}</SelectItem>
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
            {selectedIds.size} owner{selectedIds.size > 1 ? "s" : ""} selected
          </span>
          <div className="ml-auto flex gap-2">
            {/* Bulk Tier Change */}
            <Dialog open={bulkTierOpen} onOpenChange={setBulkTierOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">Change Tier</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Change Tier for {selectedIds.size} Owner{selectedIds.size > 1 ? "s" : ""}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    This will update the subscription tier for all selected owners' organizations.
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
                        {TIER_LABELS[tier]}
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
                  <AlertDialogTitle>Delete {selectedIds.size} salon owner{selectedIds.size > 1 ? "s" : ""}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the selected owners and all their data. This action cannot be undone.
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
                    Delete {selectedIds.size} Owner{selectedIds.size > 1 ? "s" : ""}
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

      {/* Edit Dialog */}
      <Dialog open={!!editOwner} onOpenChange={(open) => !open && setEditOwner(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Salon Owner</DialogTitle></DialogHeader>
          {editOwner && (
            <form onSubmit={handleEdit} className="space-y-4">
              <div className="space-y-2">
                <Label>Full Name</Label>
                <Input name="name" required defaultValue={editOwner.full_name || ""} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={editOwner.email || ""} disabled className="opacity-60" />
              </div>
              <div className="space-y-2">
                <Label>Organization Name</Label>
                <Input name="orgName" required defaultValue={editOwner.organization_name || ""} />
              </div>
              <div className="space-y-2">
                <Label>Tier</Label>
                <Select name="tier" defaultValue={editOwner.tier || "tier_1"}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tier_1">{TIER_LABELS.tier_1}</SelectItem>
                    <SelectItem value="tier_2">{TIER_LABELS.tier_2}</SelectItem>
                    <SelectItem value="tier_3">{TIER_LABELS.tier_3}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={updateOwner.isPending}>
                {updateOwner.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {owners.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                    No salon owners yet
                  </TableCell>
                </TableRow>
              ) : (
                owners.map((o) => (
                  <TableRow key={o.id} className={cn(selectedIds.has(o.id) && "bg-primary/5")}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(o.id)}
                        onCheckedChange={() => toggleSelect(o.id)}
                        aria-label={`Select ${o.full_name || o.email}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{o.full_name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{o.email}</TableCell>
                    <TableCell>
                      {o.organization_name ? (
                        <Badge variant="outline">{o.organization_name}</Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">No org</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {o.tier ? (
                        <Select
                          value={o.organization_id && pendingTierChanges[o.organization_id] ? pendingTierChanges[o.organization_id] : o.tier}
                          onValueChange={(val) => {
                            if (o.organization_id) {
                              setPendingTierChanges((prev) => {
                                const next = { ...prev };
                                if (val === o.tier) {
                                  delete next[o.organization_id!];
                                } else {
                                  next[o.organization_id!] = val as OrgTier;
                                }
                                return next;
                              });
                            }
                          }}
                          disabled={!o.organization_id}
                        >
                          <SelectTrigger className={cn("w-[150px] h-8 text-xs", o.organization_id && pendingTierChanges[o.organization_id] && "border-primary ring-1 ring-primary")}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="tier_1">Tier 1</SelectItem>
                            <SelectItem value="tier_2">Tier 2</SelectItem>
                            <SelectItem value="tier_3">Tier 3</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(o.created_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditOwner(o)}>
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
                              <AlertDialogTitle>Delete salon owner?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete {o.full_name || o.email} and all their data.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => deleteOwner.mutate(o.id)}
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
