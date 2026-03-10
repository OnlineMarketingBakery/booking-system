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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useSpamProtection } from "@/hooks/useSpamProtection";
import { SpamProtectionFields } from "@/components/SpamProtectionFields";
import { Plus, Users, Trash2, Loader2, ChevronDown, KeyRound, MapPin, Mail } from "lucide-react";
import { StaffAvailability } from "@/components/StaffAvailability";
import { StaffLocationAssignment } from "@/components/StaffLocationAssignment";

export default function Staff() {
  const { organization } = useOrganization();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmails, setInviteEmails] = useState("");
  const [selectedInviteeEmail, setSelectedInviteeEmail] = useState<string | null>(null);
  const [expandedStaff, setExpandedStaff] = useState<string | null>(null);
  const [createAccount, setCreateAccount] = useState(false);
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

  const { data: acceptedInvitees = [] } = useQuery({
    queryKey: ["staff-invitations-accepted", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_invitations")
        .select("id, email, accepted_at")
        .eq("organization_id", organization!.id)
        .eq("status", "accepted")
        .is("staff_id", null)
        .order("accepted_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organization,
  });

  const addStaff = useMutation({
    mutationFn: async ({ name, email, phone, password, locationId }: { name: string; email: string; phone: string; password?: string; locationId?: string }) => {
      const { data: newStaff, error } = await supabase
        .from("staff")
        .insert({ name, email, phone, organization_id: organization!.id })
        .select()
        .single();
      if (error) throw error;

      await supabase
        .from("staff_invitations")
        .update({ staff_id: newStaff.id })
        .eq("organization_id", organization!.id)
        .eq("email", email);

      // Assign to location if selected
      if (locationId) {
        const { error: locError } = await supabase.from("staff_locations").insert({
          staff_id: newStaff.id,
          location_id: locationId,
        });
        if (locError) throw locError;
      }

      // If password provided, create auth account
      if (password && email) {
        const { data: result, error: fnError } = await supabase.functions.invoke("create-staff-account", {
          body: {
            email,
            password,
            staff_id: newStaff.id,
            organization_id: organization!.id,
          },
        });
        if (fnError) throw fnError;
        if (result?.error) throw new Error(result.error);
      }

      return newStaff;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["staff-locations"] });
      queryClient.invalidateQueries({ queryKey: ["staff-invitations-accepted"] });
      setOpen(false);
      setCreateAccount(false);
      setSelectedLocationId("");
      setSelectedInviteeEmail(null);
      toast({ title: "Staff member added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteStaff = useMutation({
    mutationFn: async (id: string) => {
      // Soft-delete: hide from lists and booking flow; existing bookings still show this staff
      const { error } = await supabase.from("staff").update({ is_active: false }).eq("id", id);
      if (error) throw error;
      // Mark invitation as revoked so they no longer appear in "Add Staff"; they can be re-invited anytime
      await supabase
        .from("staff_invitations")
        .update({ staff_id: null, status: "revoked" })
        .eq("staff_id", id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["staff-locations"] });
      setStaffToRemove(null);
      toast({ title: "Staff removed", description: "They won't appear for new bookings; existing bookings still show them." });
    },
    onError: (err: unknown) =>
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Could not remove staff.",
        variant: "destructive",
      }),
  });

  const sendInvites = useMutation({
    mutationFn: async (emails: string[]) => {
      const { data, error } = await supabase.functions.invoke("send-staff-invites", { body: { emails } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { invited: string[]; errors: string[] };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["staff-invitations-accepted"] });
      setInviteOpen(false);
      setInviteEmails("");
      const n = data.invited?.length ?? 0;
      const errs = data.errors?.length ?? 0;
      if (n > 0) toast({ title: "Invitations sent", description: `${n} invite${n === 1 ? "" : "s"} sent.${errs > 0 ? ` ${errs} skipped or failed.` : ""}` });
      if (n === 0 && errs > 0) toast({ title: "No invitations sent", description: data.errors?.join(" ") || "All addresses skipped or failed.", variant: "destructive" });
    },
    onError: (err: unknown) => toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to send invites", variant: "destructive" }),
  });

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    const emails = inviteEmails
      .split(/[\n,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (emails.length === 0) {
      toast({ title: "Enter at least one email", variant: "destructive" });
      return;
    }
    sendInvites.mutate(emails);
  };

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!validateSpamProtection(form)) {
      toast({ title: "Please wait a moment", description: "Then try adding the staff member again.", variant: "destructive" });
      return;
    }
    const password = form.get("password") as string;
    addStaff.mutate({
      name: form.get("name") as string,
      email: form.get("email") as string,
      phone: form.get("phone") as string,
      ...(createAccount && password ? { password } : {}),
      ...(selectedLocationId ? { locationId: selectedLocationId } : {}),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Staff</h1>
          <p className="text-muted-foreground">Manage your team, availability & locations</p>
        </div>
        <Dialog open={inviteOpen} onOpenChange={(o) => { setInviteOpen(o); if (!o) setInviteEmails(""); }}>
          <DialogTrigger asChild>
            <Button variant="outline"><Mail className="mr-2 h-4 w-4" />Invite Staff</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Invite staff by email</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Enter one or more email addresses. They will receive an invitation to join; only those who accept can be added as staff.</p>
            <form onSubmit={handleInvite} className="space-y-4">
              <div className="space-y-2">
                <Label>Email addresses</Label>
                <textarea
                  className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="jane@example.com&#10;bob@example.com"
                  value={inviteEmails}
                  onChange={(e) => setInviteEmails(e.target.value)}
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">One per line or comma-separated</p>
              </div>
              <Button type="submit" className="w-full" disabled={sendInvites.isPending}>
                {sendInvites.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send invitations
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setCreateAccount(false); setSelectedLocationId(""); setSelectedInviteeEmail(null); } }}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" />Add Staff</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Staff Member</DialogTitle></DialogHeader>
            {acceptedInvitees.length === 0 ? (
              <div className="space-y-4 py-2">
                <p className="text-sm text-muted-foreground">No one has accepted an invitation yet. Use <strong>Invite Staff</strong> to send invitations by email; only people who accept will appear here and can be added as staff.</p>
                <Button variant="outline" onClick={() => { setOpen(false); setInviteOpen(true); }}><Mail className="mr-2 h-4 w-4" />Invite Staff</Button>
              </div>
            ) : !selectedInviteeEmail ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Choose someone who has accepted your invitation.</p>
                <Select value={selectedInviteeEmail ?? ""} onValueChange={(v) => setSelectedInviteeEmail(v || null)}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Select accepted invitee..." />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-50">
                    {acceptedInvitees.map((inv: { id: string; email: string }) => (
                      <SelectItem key={inv.id} value={inv.email}>{inv.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <form onSubmit={handleAdd} className="space-y-4">
                <SpamProtectionFields {...SpamProtectionFieldsProps} />
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input name="email" type="email" value={selectedInviteeEmail} readOnly className="bg-muted" />
                </div>
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input name="name" required placeholder="Jane Doe" maxLength={100} minLength={2} />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input name="phone" placeholder="+1 234 567 890" maxLength={20} pattern="[\+\d\s\-\(\)]*" title="Enter a valid phone number" />
                </div>

                {/* Branch / Location */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Branch
                  </Label>
                  {locations.length > 0 ? (
                    <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Select a branch..." />
                      </SelectTrigger>
                      <SelectContent className="bg-popover z-50">
                        {locations.map(l => (
                          <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-xs text-muted-foreground">No branches created yet. Add one in Locations first.</p>
                  )}
                </div>

                {/* Create account toggle */}
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <KeyRound className="h-4 w-4" />
                      Create login account
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Staff can sign in to view their bookings
                    </p>
                  </div>
                  <Switch checked={createAccount} onCheckedChange={setCreateAccount} />
                </div>

                {createAccount && (
                  <div className="space-y-2">
                    <Label>Password</Label>
                    <Input name="password" type="password" required placeholder="Minimum 6 characters" minLength={6} maxLength={72} />
                  </div>
                )}

                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setSelectedInviteeEmail(null)}>Back</Button>
                  <Button type="submit" className="flex-1" disabled={addStaff.isPending}>
                    {addStaff.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Add Staff
                  </Button>
                </div>
              </form>
            )}
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

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : staff.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No staff yet. Add your first team member.</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {staff.map((s) => (
            <Collapsible
              key={s.id}
              open={expandedStaff === s.id}
              onOpenChange={(open) => setExpandedStaff(open ? s.id : null)}
            >
              <Card>
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
                      <p className="text-sm text-muted-foreground">{s.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <ChevronDown className={`h-4 w-4 transition-transform ${expandedStaff === s.id ? "rotate-180" : ""}`} />
                      </Button>
                    </CollapsibleTrigger>
                    <Button variant="ghost" size="icon" onClick={() => setStaffToRemove({ id: s.id, name: s.name })}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <StaffLocationAssignment staffId={s.id} />
                </CardContent>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <StaffAvailability staffId={s.id} staffName={s.name} />
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          ))}
        </div>
      )}
    </div>
  );
}
