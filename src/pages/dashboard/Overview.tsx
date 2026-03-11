import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { PieChart, Pie, Cell } from "recharts";
import { CalendarDays, DollarSign, Users, TrendingUp, Loader2, Shield, UserPlus, Repeat } from "lucide-react";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { format } from "date-fns";

const COLORS = [
  "hsl(215, 90%, 80%)",
  "hsl(212, 80%, 65%)",
  "hsl(214, 70%, 55%)",
  "hsl(205, 100%, 47%)",
  "hsl(210, 60%, 35%)",
  "hsl(208, 90%, 25%)",
];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-warning/20 text-warning-foreground border-warning/30",
  confirmed: "bg-primary/20 text-primary border-primary/30",
  paid: "bg-success/20 text-success border-success/30",
  completed: "bg-success/20 text-success border-success/30",
  cancelled: "bg-destructive/20 text-destructive border-destructive/30",
  no_show: "bg-muted text-muted-foreground border-border",
};

export default function Overview() {
  const { organization, isLoading: orgLoading } = useOrganization();
  const { hasRole } = useAuth();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["dashboard-overview", organization?.id],
    queryFn: async () => {
      if (!organization) return null;

      const [bookingsRes, staffRes, servicesRes] = await Promise.all([
        supabase
          .from("bookings")
          .select("*, services(name, price, currency), staff(name)")
          .eq("organization_id", organization.id)
          .order("start_time", { ascending: false }),
        supabase.from("staff").select("id, name", { count: "exact" }).eq("organization_id", organization.id).eq("is_active", true),
        supabase.from("services").select("id", { count: "exact" }).eq("organization_id", organization.id),
      ]);

      const bookings = bookingsRes.data || [];
      const totalBookings = bookings.length;
      const upcoming = bookings.filter((b) => new Date(b.start_time) > new Date()).length;
      const totalStaff = staffRes.count ?? 0;
      const totalServices = servicesRes.count ?? 0;

      // Revenue from completed (and paid) bookings — total amount collected from those bookings
      const revenueFromCompletedBookings = (bookings as any[])
        .filter((b) => b.status === "completed" || b.status === "paid")
        .reduce((sum, b) => sum + Number((b.services as any)?.price ?? 0), 0);

      // Recent bookings (last 5)
      const recentBookings = bookings.slice(0, 5);

      // Bookings per status (pie)
      const statusMap = new Map<string, number>();
      for (const b of bookings) {
        statusMap.set(b.status, (statusMap.get(b.status) || 0) + 1);
      }
      const statusData = Array.from(statusMap, ([name, value]) => ({ name, value }));

      // Bookings per staff (pie)
      const staffMap = new Map<string, number>();
      for (const b of bookings) {
        const staffName = (b.staff as any)?.name || "Unassigned";
        staffMap.set(staffName, (staffMap.get(staffName) || 0) + 1);
      }
      const staffData = Array.from(staffMap, ([name, value]) => ({ name, value }));

      // Popular services (pie)
      const serviceMap = new Map<string, number>();
      for (const b of bookings) {
        const svcName = (b.services as any)?.name || "Unknown";
        serviceMap.set(svcName, (serviceMap.get(svcName) || 0) + 1);
      }
      const serviceData = Array.from(serviceMap, ([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6);

      // Recurring vs new clients: by unique customer_email
      const customerCounts = new Map<string, number>();
      for (const b of bookings) {
        const email = (b as any).customer_email;
        if (email) customerCounts.set(email, (customerCounts.get(email) || 0) + 1);
      }
      let recurringClients = 0;
      let newClients = 0;
      for (const count of customerCounts.values()) {
        if (count >= 2) recurringClients++;
        else newClients++;
      }

      return { totalBookings, upcoming, totalStaff, totalServices, revenueFromCompletedBookings, recentBookings, statusData, staffData, serviceData, recurringClients, newClients };
    },
    enabled: !!organization,
  });

  if (orgLoading) return null;
  if (!organization) {
    if (hasRole("super_admin")) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="rounded-full bg-primary/10 p-4 mb-4">
            <Shield className="h-10 w-10 text-primary" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Platform administrator</h2>
          <p className="text-muted-foreground max-w-sm mb-6">
            You manage the platform. Super admins do not have their own salon. Use the Admin Panel to manage salon owners and organizations.
          </p>
          <Button asChild>
            <Link to="/dashboard/admin">Open Admin Panel</Link>
          </Button>
        </div>
      );
    }
    return <OnboardingWizard />;
  }

  const cards = [
    { title: "Revenue Collected", value: `€${(stats?.revenueFromCompletedBookings ?? 0).toFixed(2)}`, icon: DollarSign, color: "text-primary" },
    { title: "Total Bookings", value: stats?.totalBookings ?? 0, icon: CalendarDays, color: "text-primary" },
    { title: "Upcoming", value: stats?.upcoming ?? 0, icon: TrendingUp, color: "text-primary" },
    { title: "Staff Members", value: stats?.totalStaff ?? 0, icon: Users, color: "text-primary" },
    { title: "Recurring clients", value: stats?.recurringClients ?? 0, icon: Repeat, color: "text-primary" },
    { title: "New clients", value: stats?.newClients ?? 0, icon: UserPlus, color: "text-primary" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{organization.name}</h1>
        <p className="text-muted-foreground">Dashboard</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
              <card.icon className={`h-4 w-4 ${card.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {statsLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : stats ? (
        <>
          {/* Pie Charts */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader><CardTitle className="text-base">Bookings by Status</CardTitle></CardHeader>
              <CardContent>
                <ChartContainer config={{ value: { label: "Bookings" } }} className="h-[220px] w-full">
                  <PieChart>
                    <Pie data={stats.statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="70%" label={({ name }) => name}>
                      {stats.statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                  </PieChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Bookings by Staff</CardTitle></CardHeader>
              <CardContent>
                <ChartContainer config={{ value: { label: "Bookings" } }} className="h-[220px] w-full">
                  <PieChart>
                    <Pie data={stats.staffData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="70%" label={({ name }) => name}>
                      {stats.staffData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                  </PieChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Popular Services</CardTitle></CardHeader>
              <CardContent>
                <ChartContainer config={{ value: { label: "Bookings" } }} className="h-[220px] w-full">
                  <PieChart>
                    <Pie data={stats.serviceData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="70%" label={({ name }) => name}>
                      {stats.serviceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                  </PieChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>

          {/* Recent Bookings */}
          <Card>
            <CardHeader><CardTitle className="text-base">Recent Bookings</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.recentBookings.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No bookings yet</TableCell></TableRow>
                  ) : (
                    stats.recentBookings.map((b: any) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.customer_name}</TableCell>
                        <TableCell>{b.services?.name}</TableCell>
                        <TableCell>{b.staff?.name}</TableCell>
                        <TableCell>{format(new Date(b.start_time), "MMM d, h:mm a")}</TableCell>
                        <TableCell><Badge variant="outline" className={`${STATUS_COLORS[b.status] || ""} capitalize`}>{b.status}</Badge></TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
