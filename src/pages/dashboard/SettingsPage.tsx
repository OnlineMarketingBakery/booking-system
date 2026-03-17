import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Calendar, ExternalLink, CheckCircle2, XCircle, Pencil, Loader2, Lock, Users, Trash2, Percent, Bell } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useSpamProtection } from "@/hooks/useSpamProtection";
import { HOLIDAY_REGION_OPTIONS } from "@/lib/holidays";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";

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
  const [staffToFire, setStaffToFire] = useState<{ id: string; name: string; phone?: string | null } | null>(null);
  const { validateSpamProtection, SpamProtectionFieldsProps } = useSpamProtection();

  type VatRateRow = {
    id?: string;
    name: string;
    percentage: number | null;
    is_default: boolean;
    percentage_disabled: boolean;
    sort_order: number;
  };

  const { data: vatRatesData = [], isLoading: loadingVatRates } = useQuery({
    queryKey: ["vat-rates", organization?.id],
    queryFn: async () => {
      if (!organization) return [];
      const { data, error } = await supabase
        .from("vat_rates")
        .select("id, name, percentage, is_default, percentage_disabled, sort_order")
        .eq("organization_id", organization.id)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organization,
  });

  const [vatRates, setVatRates] = useState<VatRateRow[]>([]);
  const [vatRatesSaved, setVatRatesSaved] = useState(true);
  useEffect(() => {
    setVatRates(
      vatRatesData.map((r) => ({
        id: r.id,
        name: r.name,
        percentage: r.percentage,
        is_default: r.is_default,
        percentage_disabled: r.percentage_disabled,
        sort_order: r.sort_order,
      }))
    );
  }, [vatRatesData]);

  const saveVatRates = useMutation({
    mutationFn: async (rows: VatRateRow[]) => {
      if (!organization) throw new Error("No organization");
      const originalIds = new Set((vatRatesData as { id: string }[]).map((r) => r.id));
      const currentIds = new Set(rows.filter((r) => r.id).map((r) => r.id!));
      const toDelete = [...originalIds].filter((id) => !currentIds.has(id));
      for (const id of toDelete) {
        const { error } = await supabase.from("vat_rates").delete().eq("id", id).eq("organization_id", organization.id);
        if (error) throw error;
      }
      for (const row of rows) {
        if (row.id) {
          const { error } = await supabase
            .from("vat_rates")
            .update({
              name: row.name.trim(),
              percentage: row.percentage_disabled ? null : row.percentage,
              is_default: row.is_default,
              percentage_disabled: row.percentage_disabled,
              sort_order: row.sort_order,
            })
            .eq("id", row.id)
            .eq("organization_id", organization.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("vat_rates").insert({
            organization_id: organization.id,
            name: row.name.trim(),
            percentage: row.percentage_disabled ? null : row.percentage,
            is_default: row.is_default,
            percentage_disabled: row.percentage_disabled,
            sort_order: row.sort_order,
          });
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vat-rates"] });
      setVatRatesSaved(true);
      toast({ title: "VAT rates saved", description: "Your VAT rates have been updated." });
    },
    onError: (err: unknown) =>
      toast({ title: "Error", description: err instanceof Error ? err.message : "Could not save VAT rates", variant: "destructive" }),
  });

  const updateVatRate = (index: number, patch: Partial<VatRateRow>) => {
    setVatRates((prev) => {
      const next = prev.map((r, i) => (i === index ? { ...r, ...patch } : r));
      if (patch.is_default) {
        return next.map((r, i) => (i === index ? { ...r, is_default: true } : { ...r, is_default: false }));
      }
      return next;
    });
    setVatRatesSaved(false);
  };

  const addVatRate = () => {
    setVatRates((prev) => [
      ...prev,
      { name: "", percentage: null, is_default: prev.length === 0, percentage_disabled: false, sort_order: prev.length },
    ]);
    setVatRatesSaved(false);
  };

  const removeVatRate = (index: number) => {
    setVatRates((prev) => prev.filter((_, i) => i !== index));
    setVatRatesSaved(false);
  };

  const handleSaveVatRates = () => {
    const valid = vatRates.every((r) => r.name.trim().length > 0);
    if (!valid) {
      toast({ title: "Name required", description: "Every VAT rate must have a name.", variant: "destructive" });
      return;
    }
    const withPercentage = vatRates.filter((r) => !r.percentage_disabled);
    if (withPercentage.some((r) => r.percentage === null || r.percentage === undefined)) {
      toast({ title: "Percentage required", description: "Rates with percentage enabled must have a value.", variant: "destructive" });
      return;
    }
    saveVatRates.mutate(vatRates.map((r, i) => ({ ...r, sort_order: i })));
  };

  const { data: gcalConnected, refetch } = useQuery({
    queryKey: ["gcal-connected-settings", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("google_calendar_tokens")
        .select("id")
        .eq("user_id", user!.id)
        .is("disconnected_at", null)
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  const { data: activeStaff = [], isLoading: loadingStaff } = useQuery({
    queryKey: ["staff", organization?.id],
    queryFn: async () => {
      if (!organization) return [];
      const { data, error } = await supabase
        .from("staff")
        .select("id, name, phone")
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
      const { error: bookingsError } = await supabase.from("bookings").update({ staff_id: null }).eq("staff_id", staffId).eq("organization_id", organization.id);
      if (bookingsError) throw bookingsError;
      const { error } = await supabase.from("staff").update({ is_active: false }).eq("id", staffId).eq("organization_id", organization.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["staff-locations"] });
      queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
      setStaffToFire(null);
      toast({ title: "Staff removed", description: "They will no longer appear for new bookings. Their bookings are now unassigned." });
    },
    onError: (err: unknown) =>
      toast({ title: "Error", description: err instanceof Error ? err.message : "Could not remove staff", variant: "destructive" }),
  });

  const updateReminderSettings = useMutation({
    mutationFn: async (payload: { reminder_email_day_before: boolean; reminder_email_hour_before: boolean }) => {
      if (!organization) throw new Error("No organization");
      const { error } = await supabase
        .from("organizations")
        .update(payload)
        .eq("id", organization.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization"] });
      toast({ title: "Reminder settings saved" });
    },
    onError: (err: unknown) =>
      toast({ title: "Error", description: err instanceof Error ? err.message : "Could not save", variant: "destructive" }),
  });

  useEffect(() => {
    if (searchParams.get("gcal") === "connected") {
      toast({ title: "Google Calendar connected!", description: "Existing and future bookings will appear in your Google Calendar." });
      setSearchParams({});
      refetch();
      // Sync previously created bookings to Google Calendar (server-side fire-and-forget often doesn't complete before redirect)
      if (user?.id) {
        supabase.functions
          .invoke("backfill-bookings-to-gcal", { body: { user_id: user.id } })
          .then((res) => {
            if (res.data?.synced > 0) {
              toast({ title: "Past bookings synced", description: `${res.data.synced} existing booking(s) added to your Google Calendar.` });
            }
          })
          .catch(() => {});
      }
    }
  }, [searchParams, user?.id]);

  const handleConnectGoogle = () => {
    const redirectUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-auth-callback?action=login&state=${user?.id}`;
    window.location.href = redirectUrl;
  };

  const handleDisconnect = async () => {
    const { data, error } = await supabase.functions.invoke("disconnect-gcal");
    if (error) {
      toast({ title: "Disconnect failed", description: error.message, variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["gcal-connected"] });
    queryClient.invalidateQueries({ queryKey: ["gcal-connected-settings"] });
    refetch();
    const transferred = (data as { transferred?: number })?.transferred ?? 0;
    toast({
      title: "Google Calendar disconnected",
      description: transferred > 0 ? `${transferred} event(s) transferred to your calendar.` : undefined,
    });
  };

  const syncExistingBookings = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("backfill-bookings-to-gcal", {
        body: { user_id: user!.id },
      });
      if (error) throw error;
      return data as { synced?: number; total?: number; message?: string };
    },
    onSuccess: (data) => {
      if (data?.synced && data.synced > 0) {
        toast({ title: "Past bookings synced", description: `${data.synced} booking(s) added to your Google Calendar.` });
      } else {
        toast({ title: "No bookings to sync", description: "All your bookings are already in Google Calendar." });
      }
    },
    onError: () => {
      toast({ title: "Sync failed", description: "Could not sync existing bookings. Try again.", variant: "destructive" });
    },
  });

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
              <div className="space-y-2 pt-2">
                <Label className="font-medium">Default holiday region</Label>
                <p className="text-xs text-muted-foreground">Used for public holidays when the customer has not chosen a region. Manage holidays on the Holidays page.</p>
                <Select
                  value={(organization as { holiday_region?: string })?.holiday_region ?? "NL"}
                  onValueChange={async (v) => {
                    if (!organization) return;
                    const { error } = await supabase
                      .from("organizations")
                      .update({ holiday_region: v || null })
                      .eq("id", organization.id);
                    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
                    else {
                      queryClient.invalidateQueries({ queryKey: ["organization"] });
                      toast({ title: "Holiday region updated" });
                    }
                  }}
                >
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Select region" />
                  </SelectTrigger>
                  <SelectContent>
                    {HOLIDAY_REGION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.code} value={opt.code}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Your staff
              </CardTitle>
              <CardDescription>
                Remove a staff member here. They will no longer appear for new bookings.
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
                  {activeStaff.map((s: { id: string; name: string; phone?: string | null }) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                    >
                      <div>
                        <span className="font-medium">{s.name}</span>
                        {s.phone && <span className="text-muted-foreground ml-2">({s.phone})</span>}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setStaffToFire({ id: s.id, name: s.name, phone: s.phone })}
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
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Percent className="h-5 w-5 text-primary" />
                  VAT rates
                </CardTitle>
                <CardDescription>Define VAT rates for your services. When adding a service, you can choose which rate applies.</CardDescription>
              </div>
              <Button onClick={handleSaveVatRates} disabled={vatRatesSaved || saveVatRates.isPending}>
                {saveVatRates.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Save
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingVatRates ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : (
                <>
                  <RadioGroup
                    value={vatRates.findIndex((r) => r.is_default) >= 0 ? String(vatRates.findIndex((r) => r.is_default)) : ""}
                    onValueChange={(val) => {
                      const idx = parseInt(val, 10);
                      if (!Number.isNaN(idx)) {
                        setVatRates((prev) => prev.map((r, i) => ({ ...r, is_default: i === idx })));
                        setVatRatesSaved(false);
                      }
                    }}
                    className="space-y-4"
                  >
                    {vatRates.map((rate, index) => (
                      <div key={rate.id ?? `new-${index}`} className="rounded-lg border p-4 space-y-3 border-primary/30">
                        <div className="flex gap-2 items-start justify-between">
                          <div className="grid gap-3 flex-1 max-w-md">
                            <div className="space-y-2">
                              <Label>VAT name *</Label>
                              <Input
                                value={rate.name}
                                onChange={(e) => updateVatRate(index, { name: e.target.value })}
                                placeholder="e.g. Standard rate"
                                maxLength={100}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>PERCENTAGE</Label>
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                step={0.01}
                                value={rate.percentage_disabled ? "" : (rate.percentage ?? "")}
                                onChange={(e) => updateVatRate(index, { percentage: e.target.value === "" ? null : parseFloat(e.target.value) })}
                                placeholder="21"
                                disabled={rate.percentage_disabled}
                              />
                            </div>
                            <div className="flex flex-wrap items-center gap-4">
                              <div className="flex items-center gap-2">
                                <div className="flex items-center gap-2">
                                  <RadioGroupItem value={String(index)} id={`default-${index}`} />
                                  <Label htmlFor={`default-${index}`} className="font-normal cursor-pointer">Use as default</Label>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  id={`disable-pct-${index}`}
                                  checked={rate.percentage_disabled}
                                  onCheckedChange={(checked) => updateVatRate(index, { percentage_disabled: !!checked, ...(!!checked ? { percentage: null } : {}) })}
                                />
                                <Label htmlFor={`disable-pct-${index}`} className="font-normal cursor-pointer">Disable percentage</Label>
                              </div>
                            </div>
                          </div>
                          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => removeVatRate(index)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </RadioGroup>
                  <button type="button" className="text-primary hover:underline text-sm font-medium" onClick={addVatRate}>
                    + Add new VAT rate
                  </button>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-primary" />
                Appointment reminders
              </CardTitle>
              <CardDescription>
                Automatic email reminders for customers. You can also set per-customer preferences on the Customers page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <Label className="text-base font-medium">Email reminder: day before appointment</Label>
                  <p className="text-sm text-muted-foreground">Send an email the day before the booking date.</p>
                </div>
                <Switch
                  checked={(organization as { reminder_email_day_before?: boolean })?.reminder_email_day_before ?? true}
                  onCheckedChange={(checked) => updateReminderSettings.mutate({
                    reminder_email_day_before: !!checked,
                    reminder_email_hour_before: (organization as { reminder_email_hour_before?: boolean })?.reminder_email_hour_before ?? true,
                  })}
                  disabled={updateReminderSettings.isPending}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <Label className="text-base font-medium">Email reminder: 1 hour before</Label>
                  <p className="text-sm text-muted-foreground">Send an email one hour before the appointment time.</p>
                </div>
                <Switch
                  checked={(organization as { reminder_email_hour_before?: boolean })?.reminder_email_hour_before ?? true}
                  onCheckedChange={(checked) => updateReminderSettings.mutate({
                    reminder_email_day_before: (organization as { reminder_email_day_before?: boolean })?.reminder_email_day_before ?? true,
                    reminder_email_hour_before: !!checked,
                  })}
                  disabled={updateReminderSettings.isPending}
                />
              </div>
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
              <div className="flex items-center gap-3 flex-wrap">
                {gcalConnected ? (
                  <>
                    <Badge className="bg-primary/10 text-primary border-primary/30 gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Connected
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => syncExistingBookings.mutate()}
                      disabled={syncExistingBookings.isPending}
                      className="gap-1"
                    >
                      {syncExistingBookings.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Calendar className="h-3 w-3" />}
                      Sync existing bookings
                    </Button>
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
                  ? "New bookings sync automatically. Use “Sync existing bookings” to add past bookings to Google Calendar. Your Google Calendar events block availability in the booking system."
                  : "Connect your Google account to sync existing and future bookings to Google Calendar and use your calendar events to block availability."}
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
                  {staffToFire.phone && <> ({staffToFire.phone})</>} from your staff? They will no longer appear for new bookings. Existing bookings will still show their name.
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
