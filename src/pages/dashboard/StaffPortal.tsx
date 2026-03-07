import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, CalendarDays, Clock } from "lucide-react";
import { format } from "date-fns";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-warning/20 text-warning-foreground border-warning/30",
  confirmed: "bg-primary/20 text-primary border-primary/30",
  paid: "bg-success/20 text-success border-success/30",
  completed: "bg-success/20 text-success border-success/30",
  cancelled: "bg-destructive/20 text-destructive border-destructive/30",
  no_show: "bg-muted text-muted-foreground border-border",
};

export default function StaffPortal() {
  const { user } = useAuth();
  
  // Find the staff record linked to this user
  const { data: staffRecord, isLoading: staffLoading } = useQuery({
    queryKey: ["my-staff-record", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff")
        .select("*, organizations(name)")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Fetch bookings assigned to this staff member
  const { data: bookings = [], isLoading: bookingsLoading } = useQuery({
    queryKey: ["my-bookings", staffRecord?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*, services(name, duration_minutes, price, currency), locations(name)")
        .eq("staff_id", staffRecord!.id)
        .order("start_time", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!staffRecord,
  });

  const isLoading = staffLoading || bookingsLoading;

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!staffRecord) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-muted-foreground">No staff profile linked to your account.</p>
      </div>
    );
  }

  const upcoming = bookings.filter(
    (b) => new Date(b.start_time) > new Date() && b.status !== "cancelled"
  );
  const past = bookings.filter(
    (b) => new Date(b.start_time) <= new Date() || b.status === "cancelled"
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome, {staffRecord.name}
        </h1>
        <p className="text-muted-foreground">
          {(staffRecord as any).organizations?.name} — Your bookings
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Upcoming
            </CardTitle>
            <CalendarDays className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{upcoming.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Today
            </CardTitle>
            <Clock className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {bookings.filter((b) => {
                const d = new Date(b.start_time);
                const now = new Date();
                return d.toDateString() === now.toDateString() && b.status !== "cancelled";
              }).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total
            </CardTitle>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{bookings.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Bookings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upcoming Bookings</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Date & Time</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {upcoming.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No upcoming bookings
                  </TableCell>
                </TableRow>
              ) : (
                upcoming.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <div className="font-medium">{b.customer_name}</div>
                      <div className="text-xs text-muted-foreground">{b.customer_email}</div>
                    </TableCell>
                    <TableCell>{(b.services as any)?.name}</TableCell>
                    <TableCell>
                      <div>{format(new Date(b.start_time), "MMM d, yyyy")}</div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(b.start_time), "h:mm a")} – {format(new Date(b.end_time), "h:mm a")}
                      </div>
                    </TableCell>
                    <TableCell>{(b.locations as any)?.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_COLORS[b.status] || ""}>
                        {b.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Past Bookings */}
      {past.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Past Bookings</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {past.slice(0, 20).map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.customer_name}</TableCell>
                    <TableCell>{(b.services as any)?.name}</TableCell>
                    <TableCell>
                      <div>{format(new Date(b.start_time), "MMM d, yyyy")}</div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(b.start_time), "h:mm a")}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_COLORS[b.status] || ""}>
                        {b.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
