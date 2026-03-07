import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, PieChart, Pie, Cell, LineChart, Line, ResponsiveContainer } from "recharts";
import { Loader2 } from "lucide-react";
import { format, subDays, startOfDay } from "date-fns";

const COLORS = [
  "hsl(262, 83%, 58%)",
  "hsl(152, 69%, 40%)",
  "hsl(38, 92%, 50%)",
  "hsl(0, 84%, 60%)",
  "hsl(200, 70%, 50%)",
];

export function AnalyticsCharts() {
  const { organization } = useOrganization();

  const { data, isLoading } = useQuery({
    queryKey: ["analytics", organization?.id],
    queryFn: async () => {
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString();

      const { data: bookings, error } = await supabase
        .from("bookings")
        .select("start_time, status, service_id, services(name, price, currency)")
        .eq("organization_id", organization!.id)
        .gte("start_time", thirtyDaysAgo)
        .order("start_time");
      if (error) throw error;

      // Bookings per day (last 14 days)
      const dailyMap = new Map<string, number>();
      const revenueMap = new Map<string, number>();
      for (let i = 13; i >= 0; i--) {
        const key = format(subDays(new Date(), i), "MMM d");
        dailyMap.set(key, 0);
        revenueMap.set(key, 0);
      }
      for (const b of bookings || []) {
        const key = format(new Date(b.start_time), "MMM d");
        if (dailyMap.has(key)) {
          dailyMap.set(key, (dailyMap.get(key) || 0) + 1);
        }
        if (revenueMap.has(key) && (b.status === "paid" || b.status === "completed")) {
          const price = Number((b.services as any)?.price || 0);
          revenueMap.set(key, (revenueMap.get(key) || 0) + price);
        }
      }

      const dailyBookings = Array.from(dailyMap, ([day, count]) => ({ day, count }));
      const dailyRevenue = Array.from(revenueMap, ([day, revenue]) => ({ day, revenue }));

      // Popular services
      const serviceMap = new Map<string, number>();
      for (const b of bookings || []) {
        const name = (b.services as any)?.name || "Unknown";
        serviceMap.set(name, (serviceMap.get(name) || 0) + 1);
      }
      const popularServices = Array.from(serviceMap, ([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);

      return { dailyBookings, dailyRevenue, popularServices };
    },
    enabled: !!organization,
  });

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (!data) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Bookings (Last 14 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={{ count: { label: "Bookings", color: "hsl(var(--primary))" } }} className="h-[220px] w-full">
            <BarChart data={data.dailyBookings}>
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Popular Services</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={{ value: { label: "Bookings" } }} className="h-[220px] w-full">
            <PieChart>
              <Pie data={data.popularServices} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="70%" label={({ name }) => name}>
                {data.popularServices.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
            </PieChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="text-base">Revenue Trend (Last 14 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={{ revenue: { label: "Revenue", color: "hsl(var(--success))" } }} className="h-[200px] w-full">
            <LineChart data={data.dailyRevenue}>
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line type="monotone" dataKey="revenue" stroke="hsl(152, 69%, 40%)" strokeWidth={2} dot={false} />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
