import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, CalendarDays, Search } from "lucide-react";
import { format, startOfDay, isBefore } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-warning/20 text-warning-foreground border-warning/30",
  confirmed: "bg-primary/20 text-primary border-primary/30",
  paid: "bg-success/20 text-success border-success/30",
  completed: "bg-success/20 text-success border-success/30",
  cancelled: "bg-destructive/20 text-destructive border-destructive/30",
  no_show: "bg-muted text-muted-foreground border-border",
};

export default function Bookings() {
  const { organization } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [rescheduleBooking, setRescheduleBooking] = useState<any | null>(null);
  const [newDate, setNewDate] = useState<Date | undefined>();
  const [newTime, setNewTime] = useState("");

  const { data: bookings, isLoading } = useQuery({
    queryKey: ["all-bookings", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*, services(name, duration_minutes, price, currency, vat_rates(name, percentage)), staff(name), locations(name), gcal_event_id")
        .eq("organization_id", organization!.id)
        .order("start_time", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!organization,
  });

  const { data: gcalConnected } = useQuery({
    queryKey: ["gcal-connected-bookings-list", user?.id],
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

  const { data: staffList = [] } = useQuery({
    queryKey: ["staff-list", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff")
        .select("id, name")
        .eq("organization_id", organization!.id)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organization,
  });

  const assignStaffMutation = useMutation({
    mutationFn: async ({ id, staff_id }: { id: string; staff_id: string | null }) => {
      const { error } = await supabase.from("bookings").update({ staff_id }).eq("id", id).eq("organization_id", organization!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
      toast({ title: "Staff assigned" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const rescheduleMutation = useMutation({
    mutationFn: async ({ id, start_time, end_time }: { id: string; start_time: string; end_time: string }) => {
      const { error } = await supabase.from("bookings").update({ start_time, end_time, status: "confirmed" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
      toast({ title: "Booking rescheduled" });
      setRescheduleBooking(null);
      setNewDate(undefined);
      setNewTime("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status, gcal_event_id }: { id: string; status: string; gcal_event_id?: string | null }) => {
      const { error } = await supabase.from("bookings").update({ status: status as any }).eq("id", id);
      if (error) throw error;
      if (gcalConnected && status === "cancelled" && gcal_event_id && organization?.id) {
        const { error: delErr } = await supabase.functions.invoke("delete-gcal-event", {
          body: { event_id: gcal_event_id, organization_id: organization.id },
        });
        if (delErr) {
          console.error("delete-gcal-event after cancel:", delErr);
        } else {
          const { error: clearErr } = await supabase.from("bookings").update({ gcal_event_id: null }).eq("id", id);
          if (clearErr) console.error("clear gcal_event_id after cancel:", clearErr);
        }
      } else if (
        gcalConnected &&
        (status === "confirmed" || status === "paid" || status === "pending")
      ) {
        const { error: fnErr } = await supabase.functions.invoke("sync-booking-to-gcal", {
          body: { booking_id: id },
        });
        if (fnErr) console.error("sync-booking-to-gcal after status change:", fnErr);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["gcal-events"] });
      toast({ title: "Status updated" });
    },
  });

  const handleReschedule = () => {
    if (!newDate || !newTime || !rescheduleBooking) return;
    const duration = (rescheduleBooking.services as any)?.duration_minutes || 30;
    const start = new Date(newDate);
    const [h, m] = newTime.split(":").map(Number);
    start.setHours(h, m, 0, 0);
    const end = new Date(start.getTime() + duration * 60000);
    if (isBefore(start, new Date())) {
      toast({ title: "Invalid date or time", description: "Please choose a date and time in the future.", variant: "destructive" });
      return;
    }
    rescheduleMutation.mutate({ id: rescheduleBooking.id, start_time: start.toISOString(), end_time: end.toISOString() });
  };

  const todayStart = startOfDay(new Date());
  const isSelectedDateToday = newDate && startOfDay(newDate).getTime() === todayStart.getTime();
  const now = new Date();
  const minTimeToday = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const filtered = (bookings || []).filter((b) => {
    const matchesSearch =
      b.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      b.customer_email.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || b.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Bookings</h1>
        <p className="text-muted-foreground">Manage all appointments</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by name or email…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="no_show">No Show</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>VAT</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Date & Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No bookings found</TableCell></TableRow>
              ) : (
                filtered.map((b) => {
                  const svc = b.services as { name?: string; duration_minutes?: number; price?: number; currency?: string; vat_rates?: { name?: string; percentage?: number | null } | null; vat_rate?: { name?: string; percentage?: number | null } | null } | null;
                  const vat = svc?.vat_rates ?? svc?.vat_rate;
                  const vatLabel = vat != null && vat.percentage != null ? `${vat.percentage}%` : "—";
                  return (
                  <TableRow key={b.id}>
                    <TableCell>
                      <div className="font-medium">{b.customer_name}</div>
                      <div className="text-xs text-muted-foreground">{b.customer_email}</div>
                    </TableCell>
                    <TableCell>{(b.services as any)?.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{vatLabel}</TableCell>
                    <TableCell>
                      <Select
                        value={b.staff_id ?? "unassigned"}
                        onValueChange={(val) => assignStaffMutation.mutate({ id: b.id, staff_id: val === "unassigned" ? null : val })}
                        disabled={assignStaffMutation.isPending}
                      >
                        <SelectTrigger className="h-8 w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                          {staffList.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{(b.locations as any)?.name ?? "—"}</TableCell>
                    <TableCell>
                      <div>{format(new Date(b.start_time), "MMM d, yyyy")}</div>
                      <div className="text-xs text-muted-foreground">{format(new Date(b.start_time), "h:mm a")} – {format(new Date(b.end_time), "h:mm a")}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`${STATUS_COLORS[b.status] || ""} capitalize`}>{b.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      {b.status !== "cancelled" && b.status !== "completed" && (
                        <div className="flex justify-end items-stretch gap-2 ">
                          <Button size="sm" variant="outline" onClick={() => { setRescheduleBooking(b); setNewDate(new Date(b.start_time)); setNewTime(format(new Date(b.start_time), "HH:mm")); }}>
                            <CalendarDays className="w-3" /> Reschedule
                          </Button>
                          <Select onValueChange={(val) => statusMutation.mutate({ id: b.id, status: val, gcal_event_id: b.gcal_event_id })}>
                            <SelectTrigger className="h-[36px] w-[120px] inline-flex">
                              <SelectValue placeholder="Set status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="confirmed">Confirm</SelectItem>
                              <SelectItem value="completed">Complete</SelectItem>
                              <SelectItem value="cancelled">Cancel</SelectItem>
                              <SelectItem value="no_show">No Show</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!rescheduleBooking} onOpenChange={(open) => { if (!open) setRescheduleBooking(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule Booking</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <p className="text-sm font-medium mb-1">Customer</p>
              <p className="text-sm text-muted-foreground">{rescheduleBooking?.customer_name}</p>
            </div>
            <div>
              <p className="text-sm font-medium mb-1">New Date</p>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <CalendarDays className="mr-2 h-4 w-4" />
                    {newDate ? format(newDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={newDate}
                    onSelect={setNewDate}
                    disabled={(date) => isBefore(startOfDay(date), todayStart)}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <p className="text-sm font-medium mb-1">New Time</p>
              <Input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                min={isSelectedDateToday ? minTimeToday : undefined}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleBooking(null)}>Cancel</Button>
            <Button onClick={handleReschedule} disabled={!newDate || !newTime || rescheduleMutation.isPending}>
              {rescheduleMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
