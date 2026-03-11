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
import { Plus, Users, Trash2, Loader2, KeyRound, MapPin, Pencil } from "lucide-react";
import { StaffLocationAssignment } from "@/components/StaffLocationAssignment";

export default function Staff() {
  const { organization } = useOrganization();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<{ id: string; name: string; phone: string | null } | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [staffToRemove, setStaffToRemove] = useState<{ id: string; name: string } | null>(null);
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
        .eq("is_active", true)
        .order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!organization,
  });

  const addStaff = useMutation({
    mutationFn: async ({ name, phone, locationId }: { name: string; phone: string; locationId?: string }) => {
      const { data: newStaff, error } = await supabase
        .from("staff")
        .insert({ name, phone: phone || null, organization_id: organization!.id })
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

      return newStaff;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["staff-locations"] });
      setOpen(false);
      setSelectedLocationId("");
      toast({ title: "Staff member added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateStaff = useMutation({
    mutationFn: async ({ id, name, phone }: { id: string; name: string; phone: string | null }) => {
      const { error } = await supabase
        .from("staff")
        .update({ name: name.trim(), phone: phone?.trim() || null })
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

  const deleteStaff = useMutation({
    mutationFn: async (id: string) => {
      const { error: bookingsError } = await supabase.from("bookings").update({ staff_id: null }).eq("staff_id", id);
      if (bookingsError) throw bookingsError;
      const { error } = await supabase.from("staff").update({ is_active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["staff-locations"] });
      queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
      setStaffToRemove(null);
      toast({ title: "Staff removed", description: "They won't appear for new bookings. Their bookings are now unassigned." });
    },
    onError: (err: unknown) =>
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Could not remove staff.",
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

      <AlertDialog open={!!staffToRemove} onOpenChange={(open) => !open && setStaffToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove staff member?</AlertDialogTitle>
            <AlertDialogDescription>
              {staffToRemove && (
                <>Remove <strong>{staffToRemove.name}</strong> from your staff? They will no longer appear for new bookings. Existing bookings will still show their name.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => staffToRemove && deleteStaff.mutate(staffToRemove.id)}
              disabled={deleteStaff.isPending}
            >
              {deleteStaff.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Remove
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
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {staff.map((s) => (
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
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditingStaff({ id: s.id, name: s.name, phone: s.phone })}
                      aria-label="Edit staff"
                    >
                      <Pencil className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button className="hover:bg-destructive/10" variant="ghost" size="icon" onClick={() => setStaffToRemove({ id: s.id, name: s.name })}>
                      <Trash2 className="h-4 w-4 text-destructive" />
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
    </div>
  );
}
