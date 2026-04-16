import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Pencil, Loader2, Lock, Users, Trash2, Percent, AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useSpamProtection } from "@/hooks/useSpamProtection";
import { reassignBookingsAndOrgDefaultThenDeactivate } from "@/lib/staffReassignment";
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

export default function SettingsPage() {
  const { organization } = useOrganization();
  const { changePassword, user, signOut, invokeFunction } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [staffToFire, setStaffToFire] = useState<{ id: string; name: string; phone?: string | null } | null>(null);
  const [bookingSlugDraft, setBookingSlugDraft] = useState("");
  const [slugSaving, setSlugSaving] = useState(false);
  const [resetSalonOpen, setResetSalonOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [dangerPassword, setDangerPassword] = useState("");
  const [dangerConfirm, setDangerConfirm] = useState("");
  const { validateSpamProtection, SpamProtectionFieldsProps } = useSpamProtection();

  useEffect(() => {
    if (organization?.slug) setBookingSlugDraft(organization.slug);
  }, [organization?.slug]);

  function normalizeBookingSlug(raw: string): string {
    return raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50);
  }

  const resetSalonMutation = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error("No organization");
      return invokeFunction("salon-account-danger-zone", {
        action: "reset_salon_data",
        organization_id: organization.id,
        password: dangerPassword,
        confirm_text: dangerConfirm.trim(),
      }) as Promise<{ success?: boolean; slug?: string; error?: string }>;
    },
    onSuccess: (data) => {
      setResetSalonOpen(false);
      setDangerPassword("");
      setDangerConfirm("");
      queryClient.invalidateQueries();
      toast({
        title: "Salon data reset",
        description: data?.slug
          ? `Your booking link changed to use slug “${data.slug}”. Follow the setup wizard to add your location, services, and staff again.`
          : "Your salon was cleared. Follow the setup wizard to add your location, services, and staff again.",
      });
    },
    onError: (err: unknown) =>
      toast({
        title: "Could not reset",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      }),
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async () =>
      invokeFunction("salon-account-danger-zone", {
        action: "delete_my_account",
        password: dangerPassword,
        confirm_text: dangerConfirm.trim(),
      }) as Promise<{ success?: boolean }>,
    onSuccess: async () => {
      setDeleteAccountOpen(false);
      setDangerPassword("");
      setDangerConfirm("");
      toast({ title: "Account deleted", description: "You have been signed out." });
      await signOut();
      navigate("/");
    },
    onError: (err: unknown) =>
      toast({
        title: "Could not delete account",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      }),
  });

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
      toast({ title: "BTW rates saved", description: "Your BTW rates have been updated." });
    },
    onError: (err: unknown) =>
      toast({ title: "Error", description: err instanceof Error ? err.message : "Could not save BTW rates", variant: "destructive" }),
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
      toast({ title: "Name required", description: "Every BTW rate must have a name.", variant: "destructive" });
      return;
    }
    const withPercentage = vatRates.filter((r) => !r.percentage_disabled);
    if (withPercentage.some((r) => r.percentage === null || r.percentage === undefined)) {
      toast({ title: "Percentage required", description: "Rates with percentage enabled must have a value.", variant: "destructive" });
      return;
    }
    saveVatRates.mutate(vatRates.map((r, i) => ({ ...r, sort_order: i })));
  };

  const { data: activeStaff = [], isLoading: loadingStaff } = useQuery({
    queryKey: ["staff", organization?.id],
    queryFn: async () => {
      if (!organization) return [];
      const { data, error } = await supabase
        .from("staff")
        .select("id, name, phone")
        .eq("organization_id", organization.id)
        .eq("is_active", true)
        .or("is_owner_placeholder.eq.false,is_owner_placeholder.is.null")
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organization,
  });

  const fireStaff = useMutation({
    mutationFn: async (staffId: string) => {
      if (!organization) throw new Error("No organization");
      await reassignBookingsAndOrgDefaultThenDeactivate(supabase, organization, staffId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["staff-locations"] });
      queryClient.invalidateQueries({ queryKey: ["organization"] });
      queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
      setStaffToFire(null);
      toast({
        title: "Staff removed",
        description:
          "They will no longer appear for new bookings. Their appointments were reassigned to another team member when possible.",
      });
    },
    onError: (err: unknown) =>
      toast({ title: "Error", description: err instanceof Error ? err.message : "Could not remove staff", variant: "destructive" }),
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
      toast({
        title: "Password updated",
        description: "Use your new password next time you sign in.",
      });
    } catch (err: unknown) {
      toast({ title: "Password change failed", description: err instanceof Error ? err.message : "Something went wrong", variant: "destructive" });
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">General</h2>
        <p className="text-muted-foreground text-sm">Account, organization, staff, and BTW rates.</p>
      </div>

      {user?.must_change_password && (
        <Alert className="border-amber-500/50 bg-amber-50 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
          <AlertTitle>Choose a new password</AlertTitle>
          <AlertDescription>
            Your account was set up with a one-time password. Please set a new password below before you continue using the dashboard.
          </AlertDescription>
        </Alert>
      )}

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
              <div className="space-y-2 border-t pt-3">
                <Label className="text-sm font-medium">Booking page address</Label>
                <p className="text-xs text-muted-foreground">
                  The last part of your public booking link ({typeof window !== "undefined" ? window.location.origin : ""}
                  /book/<span className="font-mono">…</span>). Use lowercase letters, numbers, and hyphens only. Changing
                  it will invalidate old links and embed codes that still use the previous address.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                      <span className="shrink-0">{typeof window !== "undefined" ? window.location.origin : ""}/book/</span>
                    </div>
                    <Input
                      value={bookingSlugDraft}
                      onChange={(e) => setBookingSlugDraft(normalizeBookingSlug(e.target.value))}
                      placeholder="my-salon"
                      maxLength={50}
                      minLength={2}
                      className="font-mono text-sm"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      slugSaving ||
                      !organization ||
                      normalizeBookingSlug(bookingSlugDraft).length < 2 ||
                      normalizeBookingSlug(bookingSlugDraft) === organization.slug
                    }
                    onClick={async () => {
                      if (!organization) return;
                      const next = normalizeBookingSlug(bookingSlugDraft);
                      if (next.length < 2) {
                        toast({
                          title: "Invalid address",
                          description: "Use at least 2 characters (letters, numbers, or hyphens).",
                          variant: "destructive",
                        });
                        return;
                      }
                      setSlugSaving(true);
                      const { error } = await supabase.from("organizations").update({ slug: next }).eq("id", organization.id);
                      setSlugSaving(false);
                      if (error) {
                        const dup =
                          error.code === "23505" ||
                          String(error.message).toLowerCase().includes("duplicate") ||
                          String(error.message).toLowerCase().includes("unique");
                        toast({
                          title: dup ? "That address is already taken" : "Could not update",
                          description: dup
                            ? "Pick a different slug. Another salon may already use this one."
                            : error.message,
                          variant: "destructive",
                        });
                        return;
                      }
                      queryClient.invalidateQueries({ queryKey: ["organization"] });
                      queryClient.invalidateQueries({ queryKey: ["booking-org"] });
                      toast({
                        title: "Booking link updated",
                        description: `Your booking page is now /book/${next}`,
                      });
                    }}
                  >
                    {slugSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    Save slug
                  </Button>
                </div>
              </div>
              {/* <p><span className="font-medium">Stripe:</span> {organization?.stripe_account_id || "Not connected"}</p> */}
              {/* <div className="space-y-2 pt-2">
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
              </div> */}
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
                  BTW rates
                </CardTitle>
                <CardDescription>Define BTW rates for your services. When adding a service, you can choose which rate applies.</CardDescription>
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
                              <Label>BTW name *</Label>
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
                    + Add new BTW rate
                  </button>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-destructive">
                <AlertTriangle className="h-5 w-5" />
                Danger zone
              </CardTitle>
              <CardDescription>
                Reset removes all salon data but keeps your email and password. Delete account removes your login and
                owned salon data permanently.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button type="button" variant="outline" className="border-destructive/50 text-destructive" onClick={() => { setDangerPassword(""); setDangerConfirm(""); setResetSalonOpen(true); }}>
                Reset salon data
              </Button>
              <Button type="button" variant="destructive" onClick={() => { setDangerPassword(""); setDangerConfirm(""); setDeleteAccountOpen(true); }}>
                Delete my account
              </Button>
            </CardContent>
          </Card>

          {/* <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base">Booking reminders &amp; Google Calendar</CardTitle>
              <CardDescription>
                Manage appointment emails and calendar sync under{" "}
                <Link to="/dashboard/settings/booking-settings" className="font-medium text-primary underline-offset-4 hover:underline">
                  Bookings → Booking settings
                </Link>
                .
              </CardDescription>
            </CardHeader>
          </Card> */}
        </>
      )}

      <AlertDialog
        open={resetSalonOpen}
        onOpenChange={(open) => {
          setResetSalonOpen(open);
          if (!open) {
            setDangerPassword("");
            setDangerConfirm("");
          }
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all salon data?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 text-left">
              <span className="block">
                This removes bookings, customers, services, staff, locations, VAT rates, and related settings for this
                salon. Your sign-in email and password stay the same. You will see the onboarding setup again.
              </span>
              <span className="block font-medium text-foreground">Enter your password and type CONFIRM to continue.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="danger-pw-reset">Password</Label>
              <Input
                id="danger-pw-reset"
                type="password"
                autoComplete="current-password"
                value={dangerPassword}
                onChange={(e) => setDangerPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="danger-confirm-reset">Type CONFIRM</Label>
              <Input id="danger-confirm-reset" value={dangerConfirm} onChange={(e) => setDangerConfirm(e.target.value)} autoComplete="off" />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={resetSalonMutation.isPending || dangerConfirm.trim() !== "CONFIRM" || !dangerPassword}
              onClick={(e) => {
                e.preventDefault();
                resetSalonMutation.mutate();
              }}
            >
              {resetSalonMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reset salon"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteAccountOpen}
        onOpenChange={(open) => {
          setDeleteAccountOpen(open);
          if (!open) {
            setDangerPassword("");
            setDangerConfirm("");
          }
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 text-left">
              <span className="block">
                This permanently deletes your Salonora account and any salons you own, including all bookings and
                settings. This cannot be undone.
              </span>
              <span className="block font-medium text-foreground">Enter your password and type CONFIRM to continue.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="danger-pw-del">Password</Label>
              <Input
                id="danger-pw-del"
                type="password"
                autoComplete="current-password"
                value={dangerPassword}
                onChange={(e) => setDangerPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="danger-confirm-del">Type CONFIRM</Label>
              <Input id="danger-confirm-del" value={dangerConfirm} onChange={(e) => setDangerConfirm(e.target.value)} autoComplete="off" />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteAccountMutation.isPending || dangerConfirm.trim() !== "CONFIRM" || !dangerPassword}
              onClick={(e) => {
                e.preventDefault();
                deleteAccountMutation.mutate();
              }}
            >
              {deleteAccountMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!staffToFire} onOpenChange={(open) => !open && setStaffToFire(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this staff member?</AlertDialogTitle>
            <AlertDialogDescription>
              {staffToFire && (
                <>
                  Remove <strong>{staffToFire.name}</strong>
                  {staffToFire.phone && <> ({staffToFire.phone})</>} from your staff? They will no longer appear for new bookings. Their open appointments are reassigned to another active team member when one is available.
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
