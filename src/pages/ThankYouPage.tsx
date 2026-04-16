import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Calendar, MapPin, User, Clock, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { AddToCalendarButtons } from "@/components/AddToCalendarButtons";
import type { CalendarEventInput } from "@/lib/calendarLinks";

export default function ThankYouPage() {
  const [searchParams] = useSearchParams();
  const bookingId = searchParams.get("booking_id");

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

  const booking = data?.booking as
    | {
        start_time: string;
        end_time?: string | null;
        customer_email?: string | null;
        services?: { name: string; duration_minutes?: number | null; price?: number; currency?: string } | null;
        staff?: { name: string } | null;
        locations?: { name: string; address?: string | null } | null;
        organizations?: { name?: string; slug?: string } | null;
      }
    | undefined;

  const orgSlug = booking?.organizations?.slug;
  const homePath = orgSlug ? `/book/${orgSlug}` : "/";

  const calendarEvent: CalendarEventInput | null = booking
    ? (() => {
        const start = new Date(booking.start_time);
        const end = booking.end_time
          ? new Date(booking.end_time)
          : new Date(start.getTime() + (Number(booking.services?.duration_minutes) || 30) * 60000);
        const orgName = booking.organizations?.name ?? "Salon";
        const serviceName = booking.services?.name ?? "Appointment";
        const loc = booking.locations;
        const locStr = loc ? `${loc.name}${loc.address ? `, ${loc.address}` : ""}` : undefined;
        return {
          title: `${orgName}: ${serviceName}`,
          description: booking.staff?.name ? `Stylist: ${booking.staff.name}` : undefined,
          location: locStr,
          start,
          end,
        };
      })()
    : null;

  const service = booking?.services;
  const staff = booking?.staff;
  const location = booking?.locations;
  const currencySymbol =
    ({ usd: "$", eur: "€", gbp: "£", cad: "C$", aud: "A$", jpy: "¥", inr: "₹", brl: "R$" } as Record<string, string>)[
      service?.currency || "eur"
    ] || "€";

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-8">
      <Card className="w-full max-w-lg border-primary/15 shadow-sm">
        <CardContent className="space-y-6 py-10 px-6 sm:px-10">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle2 className="h-10 w-10 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Thank you!</h1>
            <p className="text-muted-foreground text-sm">Your booking has been confirmed.</p>
          </div>

          {booking && (
            <div className="space-y-3 rounded-xl border bg-muted/40 p-4 text-sm">
              <h3 className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Booking details
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 sm:divide-x sm:divide-border">
                <div className="space-y-1 text-center sm:pr-4 sm:text-left">
                  <div className="flex items-center justify-center gap-2 text-muted-foreground sm:justify-start">
                    <Calendar className="h-4 w-4 shrink-0" />
                    <span className="font-semibold text-foreground">{format(new Date(booking.start_time), "MMM d")}</span>
                  </div>
                  <p className="text-muted-foreground">{format(new Date(booking.start_time), "EEEE")}</p>
                  <p className="flex items-center justify-center gap-2 text-muted-foreground sm:justify-start">
                    <Clock className="h-4 w-4 shrink-0" />
                    {format(new Date(booking.start_time), "HH:mm")}
                    {" – "}
                    {format(
                      booking.end_time
                        ? new Date(booking.end_time)
                        : new Date(
                            new Date(booking.start_time).getTime() +
                              (Number(service?.duration_minutes) || 30) * 60000,
                          ),
                      "HH:mm",
                    )}
                  </p>
                </div>
                <div className="space-y-2 text-center sm:pl-4 sm:text-left">
                  {service && (
                    <p className="font-medium leading-snug">
                      {service.name} — {service.duration_minutes} min — {currencySymbol}
                      {Number(service.price).toFixed(2)}
                    </p>
                  )}
                  {staff && (
                    <p className="flex items-center justify-center gap-2 text-muted-foreground sm:justify-start">
                      <User className="h-4 w-4 shrink-0" />
                      {staff.name}
                    </p>
                  )}
                  {location && (
                    <p className="flex items-start justify-center gap-2 text-muted-foreground sm:justify-start">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        {location.name}
                        {location.address ? ` — ${location.address}` : ""}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {calendarEvent ? <AddToCalendarButtons event={calendarEvent} icsFileName="salon-appointment" /> : null}

          {booking?.customer_email && (
            <p className="text-center text-sm text-muted-foreground">
              A confirmation email with calendar links was sent to <strong>{booking.customer_email}</strong>.
            </p>
          )}

          <Button asChild variant="outline" className="w-full">
            <Link to={homePath}>Book another appointment</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
