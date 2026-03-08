import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, Phone, Calendar } from "lucide-react";
import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface CustomerRecord {
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  total_bookings: number;
  last_booking: string;
  statuses: string[];
}

export default function Customers() {
  const { organization } = useOrganization();

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["customers", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("customer_name, customer_email, customer_phone, start_time, status")
        .eq("organization_id", organization!.id)
        .order("start_time", { ascending: false });
      if (error) throw error;

      // Group by email
      const map = new Map<string, CustomerRecord>();
      for (const b of data) {
        const existing = map.get(b.customer_email);
        if (existing) {
          existing.total_bookings++;
          if (!existing.statuses.includes(b.status)) existing.statuses.push(b.status);
        } else {
          map.set(b.customer_email, {
            customer_name: b.customer_name,
            customer_email: b.customer_email,
            customer_phone: b.customer_phone,
            total_bookings: 1,
            last_booking: b.start_time,
            statuses: [b.status],
          });
        }
      }
      return Array.from(map.values());
    },
    enabled: !!organization,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
        <p className="text-muted-foreground">View customer history and contact details</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : customers.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No customers yet.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="text-center">Bookings</TableHead>
                  <TableHead>Visit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow key={c.customer_email}>
                    <TableCell className="font-medium">{c.customer_name}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 text-sm">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Mail className="h-3 w-3" />{c.customer_email}
                        </span>
                        {c.customer_phone && (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Phone className="h-3 w-3" />{c.customer_phone}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{c.total_bookings}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {format(new Date(c.last_booking), "MMM d, yyyy")}
                      </span>
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
