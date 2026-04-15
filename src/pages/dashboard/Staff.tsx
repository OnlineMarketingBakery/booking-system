import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useSpamProtection } from "@/hooks/useSpamProtection";
import { SpamProtectionFields } from "@/components/SpamProtectionFields";
import { Plus, Users, Loader2, KeyRound, MapPin, Pencil, UserX, RotateCcw } from "lucide-react";
import { StaffLocationAssignment } from "@/components/StaffLocationAssignment";
import { reassignBookingsAndOrgDefaultThenDeactivate } from "@/lib/staffReassignment";

export default function Staff() {
  const { organization } = useOrganization();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<{
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
  } | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [staffToDeactivate, setStaffToDeactivate] = useState<{ id: string; name: string } | null>(null);
  const { validateSpamProtection, SpamProtectionFieldsProps } = useSpamProtection();

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("*")
        .eq("organization_id", organization!.id)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
    enabled: !!organization,
  });

  const { data: staff = [], isLoading } = useQuery({
    queryKey: ["staff", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff")
        .select("*")
        .eq("organization_id", organization!.id)
        .or("is_owner_placeholder.eq.false,is_owner_placeholder.is.null")
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organization,
  });

  const activeTeam = staff.filter((s) => s.is_active);
  const inactiveTeam = staff.filter((s) => !s.is_active);

  const addStaff = useMutation({
    mutationFn: async ({
      name,
      phone,
      email,
      locationId,
    }: {
      name: string;
      phone: string;
      email: string | null;
      locationId?: string;
    }) => {
      const { data: newStaff, error } = await supabase
        .from("staff")
        .insert({
          name,
          phone: phone || null,
          email: email?.trim() || null,
          organization_id: organization!.id,
        })
        .select()
        .single();
      if (error) throw error;

      if (locationId) {
        const { error: locError } = await supabase.from("staff_locations").insert({
          staff_id: newStaff.id,
          location_id: locationId,
        });
        if (locError) throw locError;
      }

      if (organization?.owner_default_staff_id && newStaff?.id) {
        const { data: cur } = await supabase
          .from("staff")
          .select("is_owner_placeholder")
          .eq("id", organization.owner_default_staff_id)
          .maybeSingle();
        if (cur?.is_owner_placeholder) {
          await supabase
            .from("organizations")
            .update({ owner_default_staff_id: newStaff.id })
            .eq("id", organization.id);
        }
      }

      return newStaff;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["staff-locations"] });
      queryClient.invalidateQueries({ queryKey: ["organization"] });
      setOpen(false);
      setSelectedLocationId("");
      toast({ title: "Staff member added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateStaff = useMutation({
    mutationFn: async ({
      id,
      name,
      phone,
      email,
    }: {
      id: string;
      name: string;
      phone: string | null;
      email: string | null;
    }) => {
      const { error } = await supabase
        .from("staff")
        .update({
          name: name.trim(),
          phone: phone?.trim() || null,
          email: email?.trim() || null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      setEditingStaff(null);
      toast({ title: "Staff updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deactivateStaff = useMutation({
    mutationFn: async (id: string) => {
      if (!organization) throw new Error("No organization");
      await reassignBookingsAndOrgDefaultThenDeactivate(supabase, organization, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["staff-locations"] });
      queryClient.invalidateQueries({ queryKey: ["organization"] });
      queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
      setStaffToDeactivate(null);
      toast({
        title: "Staff deactivated",
        description: "They no longer appear in the booking widget. Existing bookings were moved to the salon default assignee where possible.",
      });
    },
    onError: (err: unknown) =>
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Could not deactivate staff.",
        variant: "destructive",
      }),
  });

  const reactivateStaff = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("staff")
        .update({ is_active: true })
        .eq("id", id)
        .eq("organization_id", organization!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["staff-locations"] });
      toast({ title: "Staff reactivated" });
    },
    onError: (err: unknown) =>
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Could not reactivate staff.",
        variant: "destructive",
      }),
  });

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!validateSpamProtection(form)) {
      toast({ title: "Please wait a moment", description: "Then try adding the staff member again.", variant: "destructive" });
      return;
    }
    addStaff.mutate({
      name: (form.get("name") as string).trim(),
      phone: (form.get("phone") as string)?.trim() ?? "",
      email: ((form.get("email") as string) ?? "").trim() || null,
      ...(selectedLocationId ? { locationId: selectedLocationId } : {}),
    });
  };

  const handleEdit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingStaff) return;
    const form = new FormData(e.currentTarget);
    updateStaff.mutate({
      id: editingStaff.id,
      name: (form.get("editName") as string).trim(),
      phone: (form.get("editPhone") as string)?.trim() || null,
      email: ((form.get("editEmail") as string) ?? "").trim() || null,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Staff</h1>
          <p className="text-muted-foreground">Manage your team and location assignments</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSelectedLocationId(""); }}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" />Add Staff</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Staff Member</DialogTitle></DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              <SpamProtectionFields {...SpamProtectionFieldsProps} />
              <div className="space-y-2">
                <Label>Name</Label>
                <Input name="name" required placeholder="e.g. Jane Doe" maxLength={100} minLength={2} />
              </div>
              <div className="space-y-2">
                <Label>Phone (optional)</Label>
                <Input name="phone" placeholder="+1 234 567 890" maxLength={20} pattern="[\+\d\s\-\(\)]*" title="Enter a valid phone number" />
              </div>
              <div className="space-y-2">
                <Label>Email (optional)</Label>
                <Input name="email" type="email" placeholder="jane@example.com" maxLength={255} />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Location
                </Label>
                {locations.length > 0 ? (
                  <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Select a location (optional)..." />
                    </SelectTrigger>
                    <SelectContent className="bg-popover z-50">
                      {locations.map(l => (
                        <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground">No locations yet. Add one in Locations first.</p>
                )}
              </div>

              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" className="flex-1" disabled={addStaff.isPending}>
                  {addStaff.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add Staff
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <AlertDialog open={!!staffToDeactivate} onOpenChange={(open) => !open && setStaffToDeactivate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate staff member?</AlertDialogTitle>
            <AlertDialogDescription>
              {staffToDeactivate && (
                <>
                  Deactivate <strong>{staffToDeactivate.name}</strong>? They will disappear from the public booking flow. Bookings assigned to them
                  will be reassigned to your salon default inbox when one is configured.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => staffToDeactivate && deactivateStaff.mutate(staffToDeactivate.id)}
              disabled={deactivateStaff.isPending}
            >
              {deactivateStaff.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!editingStaff} onOpenChange={(o) => !o && setEditingStaff(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Staff Member</DialogTitle></DialogHeader>
          {editingStaff && (
            <form onSubmit={handleEdit} className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  name="editName"
                  required
                  placeholder="e.g. Jane Doe"
                  maxLength={100}
                  minLength={2}
                  defaultValue={editingStaff.name}
                />
              </div>
              <div className="space-y-2">
                <Label>Phone (optional)</Label>
                <Input
                  name="editPhone"
                  placeholder="+1 234 567 890"
                  maxLength={20}
                  defaultValue={editingStaff.phone ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label>Email (optional)</Label>
                <Input
                  name="editEmail"
                  type="email"
                  placeholder="jane@example.com"
                  maxLength={255}
                  defaultValue={editingStaff.email ?? ""}
                />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setEditingStaff(null)}>Cancel</Button>
                <Button type="submit" className="flex-1" disabled={updateStaff.isPending}>
                  {updateStaff.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save changes
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : staff.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No staff yet. Add your first team member.</CardContent></Card>
      ) : (
        <div className="space-y-8">
          {activeTeam.length > 0 && (
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {activeTeam.map((s) => (
                <Card key={s.id}>
                  <CardHeader className="flex flex-row items-start justify-between pb-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                        <Users className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base">{s.name}</CardTitle>
                          {s.user_id && (
                            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
                              <KeyRound className="h-3 w-3 mr-1" />
                              Account
                            </Badge>
                          )}
                        </div>
                        {s.phone && <p className="text-sm text-muted-foreground">{s.phone}</p>}
                        {s.email && <p className="text-sm text-muted-foreground">{s.email}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          setEditingStaff({
                            id: s.id,
                            name: s.name,
                            phone: s.phone,
                            email: (s as { email?: string | null }).email ?? null,
                          })
                        }
                        aria-label="Edit staff"
                      >
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button
                        className="hover:bg-destructive/10"
                        variant="ghost"
                        size="icon"
                        onClick={() => setStaffToDeactivate({ id: s.id, name: s.name })}
                        aria-label="Deactivate staff"
                      >
                        <UserX className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <StaffLocationAssignment staffId={s.id} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {inactiveTeam.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-muted-foreground">Inactive</h2>
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {inactiveTeam.map((s) => (
                  <Card key={s.id} className="opacity-90 border-dashed">
                    <CardHeader className="flex flex-row items-start justify-between pb-2">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                          <Users className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div>
                          <CardTitle className="text-base">{s.name}</CardTitle>
                          <Badge variant="secondary" className="mt-1 text-xs">
                            Deactivated
                          </Badge>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => reactivateStaff.mutate(s.id)}
                        disabled={reactivateStaff.isPending}
                      >
                        {reactivateStaff.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1" />}
                        Reactivate
                      </Button>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
