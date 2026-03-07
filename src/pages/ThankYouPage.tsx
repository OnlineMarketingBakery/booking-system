import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Calendar, MapPin, User, Clock, Loader2 } from "lucide-react";
import { format } from "date-fns";

export default function ThankYouPage() {
  const [searchParams] = useSearchParams();
  const bookingId = searchParams.get("booking_id");

  // Fetch booking details via the verify edge function (uses service role, bypasses RLS)
  const { data, isLoading } = useQuery({
    queryKey: ["verify-booking", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("verify-booking-payment", {
        body: { booking_id: bookingId },
      });
      if (error) throw error;
      return data;
    },
    enabled: !!bookingId,
  });

  const booking = data?.booking;

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const service = booking?.services as any;
  const staff = booking?.staff as any;
  const location = booking?.locations as any;
  const currencySymbol = ({ usd: "$", eur: "€", gbp: "£", cad: "C$", aud: "A$", jpy: "¥", inr: "₹", brl: "R$" } as Record<string, string>)[service?.currency || "usd"] || "$";

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-8">
      <Card className="w-full max-w-md">
        <CardContent className="py-10 space-y-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle2 className="h-10 w-10 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">Thank You!</h1>
            <p className="text-muted-foreground">Your booking has been confirmed and payment received.</p>
          </div>

          {booking && (
            <div className="space-y-3 rounded-lg border bg-muted/50 p-4 text-sm">
              <h3 className="font-semibold">Booking Details</h3>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-4 w-4 shrink-0" />
                <span>{format(new Date(booking.start_time), "EEEE, MMMM d, yyyy 'at' h:mm a")}</span>
              </div>
              {service && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4 shrink-0" />
                  <span>{service.name} — {service.duration_minutes} min — {currencySymbol}{Number(service.price).toFixed(2)}</span>
                </div>
              )}
              {staff && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <User className="h-4 w-4 shrink-0" />
                  <span>{staff.name}</span>
                </div>
              )}
              {location && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0" />
                  <span>{location.name}{location.address ? ` — ${location.address}` : ""}</span>
                </div>
              )}
            </div>
          )}

          {booking?.customer_email && (
            <p className="text-center text-sm text-muted-foreground">
              A confirmation email will be sent to <strong>{booking.customer_email}</strong>.
            </p>
          )}

          <Button asChild variant="outline" className="w-full">
            <Link to="/">Back to Home</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
