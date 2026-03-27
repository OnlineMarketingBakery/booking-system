import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Bell, Calendar, CheckCircle2, ExternalLink, Loader2, XCircle } from "lucide-react";

export function BookingAutomationCards() {
  const { organization } = useOrganization();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

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

  const updateReminderSettings = useMutation({
    mutationFn: async (payload: { reminder_email_day_before: boolean; reminder_email_hour_before: boolean }) => {
      if (!organization) throw new Error("No organization");
      const { error } = await supabase.from("organizations").update(payload).eq("id", organization.id);
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
      toast({
        title: "Google Calendar connected!",
        description: "Existing and future bookings will appear in your Google Calendar.",
      });
      setSearchParams({});
      refetch();
      if (user?.id) {
        supabase.functions
          .invoke("backfill-bookings-to-gcal", { body: { user_id: user.id } })
          .then((res) => {
            if (res.data?.synced > 0) {
              toast({
                title: "Past bookings synced",
                description: `${res.data.synced} existing booking(s) added to your Google Calendar.`,
              });
            }
          })
          .catch(() => {});
      }
    }
  }, [searchParams, user?.id, refetch, setSearchParams, toast]);

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
        toast({ title: "Past bookings synced", description: `${data.synced} booking(s) added to Google Calendar.` });
      } else {
        toast({ title: "No bookings to sync", description: "All your bookings are already in Google Calendar." });
      }
    },
    onError: () => {
      toast({ title: "Sync failed", description: "Could not sync existing bookings. Try again.", variant: "destructive" });
    },
  });

  if (!organization) return null;

  return (
    <>
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
              onCheckedChange={(checked) =>
                updateReminderSettings.mutate({
                  reminder_email_day_before: !!checked,
                  reminder_email_hour_before: (organization as { reminder_email_hour_before?: boolean })?.reminder_email_hour_before ?? true,
                })
              }
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
              onCheckedChange={(checked) =>
                updateReminderSettings.mutate({
                  reminder_email_day_before: (organization as { reminder_email_day_before?: boolean })?.reminder_email_day_before ?? true,
                  reminder_email_hour_before: !!checked,
                })
              }
              disabled={updateReminderSettings.isPending}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Google Calendar integration
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
  );
}
