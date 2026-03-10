import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Calendar, ExternalLink, CheckCircle2, XCircle, Pencil, Loader2, Lock, Mail, Trash2, Users } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useSpamProtection } from "@/hooks/useSpamProtection";
import { SpamProtectionFields } from "@/components/SpamProtectionFields";
import { useQueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
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

export default function SettingsPage() {
  const { organization } = useOrganization();
  const { user, changePassword } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [staffToFire, setStaffToFire] = useState<{ id: string; name: string; email: string | null } | null>(null);
  const { validateSpamProtection, SpamProtectionFieldsProps } = useSpamProtection();

  const { data: gcalConnected, refetch } = useQuery({
    queryKey: ["gcal-connected-settings", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("google_calendar_tokens")
        .select("id")
        .eq("user_id", user!.id)
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  const { data: acceptedInvitees = [], isLoading: loadingInvitees } = useQuery({
    queryKey: ["staff-invitations-accepted", organization?.id],
    queryFn: async () => {
      if (!organization) return [];
      const { data, error } = await supabase
        .from("staff_invitations")
        .select("id, email, accepted_at")
        .eq("organization_id", organization.id)
        .eq("status", "accepted")
        .is("staff_id", null)
        .order("accepted_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organization,
  });

  const removeAcceptedInvite = useMutation({
    mutationFn: async (invitationId: string) => {
      if (!organization) throw new Error("No organization");
      const { error } = await supabase
        .from("staff_invitations")
        .delete()
        .eq("id", invitationId)
        .eq("organization_id", organization.id)
        .eq("status", "accepted")
        .is("staff_id", null);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-invitations-accepted"] });
      toast({ title: "Invitation removed", description: "They will no longer appear in Add Staff. You can send a new invitation from Staff if needed." });
    },
    onError: (err: unknown) =>
      toast({ title: "Error", description: err instanceof Error ? err.message : "Could not remove invitation", variant: "destructive" }),
  });

  const { data: activeStaff = [], isLoading: loadingStaff } = useQuery({
    queryKey: ["staff", organization?.id],
    queryFn: async () => {
      if (!organization) return [];
      const { data, error } = await supabase
        .from("staff")
        .select("id, name, email")
        .eq("organization_id", organization.id)
        .eq("is_active", true)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organization,
  });

  const fireStaff = useMutation({
    mutationFn: async (staffId: string) => {
      if (!organization) throw new Error("No organization");
      const { error } = await supabase.from("staff").update({ is_active: false }).eq("id", staffId).eq("organization_id", organization.id);
      if (error) throw error;
      await supabase
        .from("staff_invitations")
        .update({ staff_id: null, status: "revoked" })
        .eq("staff_id", staffId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["staff-locations"] });
      queryClient.invalidateQueries({ queryKey: ["staff-invitations-accepted"] });
      setStaffToFire(null);
      toast({ title: "Staff removed", description: "They will no longer appear for new bookings. Existing bookings still show their name. You can re-invite them from the Staff page anytime." });
    },
    onError: (err: unknown) =>
      toast({ title: "Error", description: err instanceof Error ? err.message : "Could not remove staff", variant: "destructive" }),
  });

  useEffect(() => {
    if (searchParams.get("gcal") === "connected") {
      toast({ title: "Google Calendar connected!", description: "Your calendar is now synced." });
      setSearchParams({});
      refetch();
    }
  }, [searchParams]);

  const handleConnectGoogle = () => {
    const redirectUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-auth-callback?action=login&state=${user?.id}`;
    window.location.href = redirectUrl;
  };

  const handleDisconnect = async () => {
    await supabase
      .from("google_calendar_tokens")
      .delete()
      .eq("user_id", user!.id);
    refetch();
    toast({ title: "Google Calendar disconnected" });
  };

  const handleChangePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!validateSpamProtection(e.currentTarget)) {
      toast({ title: "Please wait a moment", description: "Then try again.", variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: "Password too short", description: "Use at least 6 characters.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setChangingPassword(true);
    try {
      await changePassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password updated", description: "Use your new password next time you sign in." });
    } catch (err: unknown) {
      toast({ title: "Password change failed", description: err instanceof Error ? err.message : "Something went wrong", variant: "destructive" });
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          {organization ? "Manage your salon settings" : "Manage your account"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            Account
          </CardTitle>
          <CardDescription>Change your password</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-3 max-w-sm">
            <SpamProtectionFields {...SpamProtectionFieldsProps} />
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                minLength={6}
                maxLength={128}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                minLength={6}
                maxLength={128}
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" disabled={changingPassword}>
              {changingPassword && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Change password
            </Button>
          </form>
        </CardContent>
      </Card>

      {organization && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-primary" />
                Organization
              </CardTitle>
              <CardDescription>Your salon details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">Name:</span>
                {editingName ? (
                  <form
                    className="flex items-center gap-2 flex-1"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!validateSpamProtection(e.currentTarget)) {
                        toast({ title: "Please wait a moment", description: "Then try again.", variant: "destructive" });
                        return;
                      }
                      if (!newName.trim() || !organization) return;
                      setSaving(true);
                      const { error } = await supabase
                        .from("organizations")
                        .update({ name: newName.trim() })
                        .eq("id", organization.id);
                      setSaving(false);
                      if (error) {
                        toast({ title: "Error", description: error.message, variant: "destructive" });
                      } else {
                        toast({ title: "Salon name updated" });
                        queryClient.invalidateQueries({ queryKey: ["organization"] });
                        setEditingName(false);
                      }
                    }}
                  >
                    <SpamProtectionFields {...SpamProtectionFieldsProps} />
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="h-8 max-w-[220px]"
                      required
                      minLength={2}
                      maxLength={100}
                      autoFocus
                    />
                    <Button type="submit" size="sm" disabled={saving}>
                      {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                      Save
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditingName(false)}>
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <>
                    <span>{organization?.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => { setNewName(organization?.name || ""); setEditingName(true); }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
              <p><span className="font-medium">Slug:</span> {organization?.slug}</p>
              <p><span className="font-medium">Stripe:</span> {organization?.stripe_account_id || "Not connected"}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Your staff
              </CardTitle>
              <CardDescription>
                Remove a staff member here to fire them. They will no longer appear for new bookings (existing bookings still show their name). That email cannot be used to add staff again.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingStaff ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : activeStaff.length === 0 ? (
                <p className="text-sm text-muted-foreground">No staff yet. Add staff from the Staff page.</p>
              ) : (
                <ul className="space-y-2">
                  {activeStaff.map((s: { id: string; name: string; email: string | null }) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                    >
                      <div>
                        <span className="font-medium">{s.name}</span>
                        {s.email && <span className="text-muted-foreground ml-2">({s.email})</span>}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setStaffToFire({ id: s.id, name: s.name, email: s.email })}
                      >
                        <Trash2 className="h-3 w-3" /> Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" />
                Staff invitations
              </CardTitle>
              <CardDescription>
                People who accepted your invitation but are not yet added as staff. Remove them here if you no longer want to add them; they will disappear from the Add Staff list.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingInvitees ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : acceptedInvitees.length === 0 ? (
                <p className="text-sm text-muted-foreground">No accepted invitations. Anyone who accepts an invite will appear here until you add them as staff on the Staff page.</p>
              ) : (
                <ul className="space-y-2">
                  {acceptedInvitees.map((inv: { id: string; email: string; accepted_at: string }) => (
                    <li
                      key={inv.id}
                      className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                    >
                      <span>{inv.email}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => removeAcceptedInvite.mutate(inv.id)}
                        disabled={removeAcceptedInvite.isPending && removeAcceptedInvite.variables === inv.id}
                      >
                        {(removeAcceptedInvite.isPending && removeAcceptedInvite.variables === inv.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                Google Calendar Integration
              </CardTitle>
              <CardDescription>Sync bookings and block availability from your Google Calendar</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                {gcalConnected ? (
                  <>
                    <Badge className="bg-primary/10 text-primary border-primary/30 gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Connected
                    </Badge>
                    <Button variant="outline" size="sm" onClick={handleDisconnect} className="text-destructive gap-1">
                      <XCircle className="h-3 w-3" /> Disconnect
                    </Button>
                  </>
                ) : (
                  <Button onClick={handleConnectGoogle} className="gap-2">
                    <ExternalLink className="h-4 w-4" />
                    Connect Google Calendar
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {gcalConnected
                  ? "Bookings will automatically appear in your Google Calendar. Your Google Calendar events will block availability in the booking system."
                  : "Connect your Google account to automatically sync bookings and use your calendar events to block availability."}
              </p>
            </CardContent>
          </Card>
        </>
      )}

      <AlertDialog open={!!staffToFire} onOpenChange={(open) => !open && setStaffToFire(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this staff member?</AlertDialogTitle>
            <AlertDialogDescription>
              {staffToFire && (
                <>
                  Remove <strong>{staffToFire.name}</strong>
                  {staffToFire.email && <> ({staffToFire.email})</>} from your staff? They will no longer appear for new bookings. Existing bookings will still show their name. This email cannot be used to add staff again.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => staffToFire && fireStaff.mutate(staffToFire.id)}
              disabled={fireStaff.isPending}
            >
              {fireStaff.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
