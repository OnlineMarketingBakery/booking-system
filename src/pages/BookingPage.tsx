import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarWidget } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useSpamProtection } from "@/hooks/useSpamProtection";
import { SpamProtectionFields } from "@/components/SpamProtectionFields";
import {
  Scissors,
  Loader2,
  CheckCircle2,
  Calendar,
  MapPin,
  User,
  Clock,
  CreditCard,
} from "lucide-react";
import {
  format,
  addMinutes,
  addDays,
  isBefore,
  isAfter,
  setHours,
  setMinutes,
} from "date-fns";
import { DEFAULT_EMBED_THEME, hexToHsl, hexToHslWithAlpha, hexToRgba } from "@/types/embedTheme";
import type { EmbedTheme } from "@/types/embedTheme";

type Step = "location" | "service" | "staff" | "time" | "details" | "confirmed";

export default function BookingPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { validateSpamProtection, SpamProtectionFieldsProps } = useSpamProtection();
  const [step, setStep] = useState<Step>("location");
  const [selectedLocation, setSelectedLocation] = useState<string>("");
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>(
    format(new Date(), "yyyy-MM-dd"),
  );
  const [booking, setBooking] = useState(false);

  const bookingIdFromUrl = searchParams.get("booking_id");
  const isSuccess = window.location.pathname.includes("/book/success");
  const isCancel = window.location.pathname.includes("/book/cancel");

  const { data: paymentStatus } = useQuery({
    queryKey: ["verify-payment", bookingIdFromUrl],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "verify-booking-payment",
        {
          body: { booking_id: bookingIdFromUrl },
        },
      );
      if (error) throw error;
      return data;
    },
    enabled: isSuccess && !!bookingIdFromUrl,
  });

  const { data: org, isLoading: orgLoading } = useQuery({
    queryKey: ["booking-org", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations_public")
        .select("id, name, slug, logo_url, embed_theme")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!slug && !isSuccess && !isCancel,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["booking-locations", org?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("*")
        .eq("organization_id", org!.id)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
    enabled: !!org,
  });

  const { data: services = [] } = useQuery({
    queryKey: ["booking-services", org?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("organization_id", org!.id)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
    enabled: !!org,
  });

  const { data: staffList = [] } = useQuery({
    queryKey: ["booking-staff", selectedLocation],
    queryFn: async () => {
      const { data: staffLocations, error } = await supabase
        .from("staff_locations")
        .select("staff_id")
        .eq("location_id", selectedLocation);
      if (error) throw error;
      const staffIds = staffLocations?.map((sl) => sl.staff_id) || [];
      if (staffIds.length === 0) return [];

      const { data: staffData, error: staffError } = await supabase
        .from("staff_public")
        .select("id, name")
        .in("id", staffIds)
        .eq("is_active", true);
      if (staffError) throw staffError;
      return staffData || [];
    },
    enabled: !!selectedLocation,
  });

  // Calculate total duration from selected services
  const selectedServiceObjects = services.filter((s) =>
    selectedServices.includes(s.id),
  );
  const totalDuration = selectedServiceObjects.reduce(
    (sum, s) => sum + s.duration_minutes,
    0,
  );
  const totalPrice = selectedServiceObjects.reduce(
    (sum, s) => sum + Number(s.price),
    0,
  );

  // Fetch which days of week the staff works (for calendar disabling)
  const { data: staffAvailDays = [] } = useQuery({
    queryKey: ["booking-staff-avail-days", selectedStaff],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("availability")
        .select("day_of_week")
        .eq("staff_id", selectedStaff);
      if (error) throw error;
      // Return unique days
      return [...new Set(data.map((r) => r.day_of_week))];
    },
    enabled: !!selectedStaff,
  });

  const { data: timeSlots = [] } = useQuery({
    queryKey: ["booking-slots", selectedStaff, selectedDate, selectedServices],
    queryFn: async () => {
      const dayOfWeek = new Date(selectedDate + "T00:00:00").getDay();
      const { data: avail } = await supabase
        .from("availability")
        .select("*")
        .eq("staff_id", selectedStaff)
        .eq("day_of_week", dayOfWeek);

      if (!avail || avail.length === 0) return [];

      const dayStart = new Date(selectedDate + "T00:00:00").toISOString();
      const dayEnd = new Date(selectedDate + "T23:59:59").toISOString();
      const { data: existing } = await supabase
        .from("bookings")
        .select("start_time, end_time")
        .eq("staff_id", selectedStaff)
        .gte("start_time", dayStart)
        .lte("start_time", dayEnd)
        .neq("status", "cancelled");

      // Fetch Google Calendar events to block availability
      let gcalEvents: { start: string; end: string }[] = [];
      try {
        // Get org owner to check their gcal
        const { data: staffRow } = await supabase
          .from("staff_public")
          .select("organization_id")
          .eq("id", selectedStaff)
          .single();
        if (staffRow) {
          const { data: orgRow } = await supabase
            .from("organizations_public")
            .select("id")
            .eq("id", staffRow.organization_id!)
            .single();
          if (orgRow) {
            const { data: gcalData } = await supabase.functions.invoke(
              "fetch-gcal-events",
              {
                body: {
                  user_id: org!.id, // We pass org id; edge fn uses owner_id
                  time_min: dayStart,
                  time_max: dayEnd,
                },
              },
            );
            if (gcalData?.events) {
              gcalEvents = gcalData.events.map((e: any) => ({
                start: e.start,
                end: e.end,
              }));
            }
          }
        }
      } catch {
        // Silently ignore gcal fetch errors for public booking
      }

      const duration = totalDuration || 30;
      const slots: { time: string; available: boolean }[] = [];

      for (const a of avail) {
        const [sh, sm] = a.start_time.split(":").map(Number);
        const [eh, em] = a.end_time.split(":").map(Number);
        let current = setMinutes(
          setHours(new Date(selectedDate + "T00:00:00"), sh),
          sm,
        );
        const end = setMinutes(
          setHours(new Date(selectedDate + "T00:00:00"), eh),
          em,
        );

        while (
          isBefore(addMinutes(current, duration), end) ||
          format(addMinutes(current, duration), "HH:mm") ===
            format(end, "HH:mm")
        ) {
          const slotEnd = addMinutes(current, duration);
          const isPast = !isAfter(current, new Date());
          const bookingConflict = existing?.some((b) => {
            const bs = new Date(b.start_time);
            const be = new Date(b.end_time);
            return isBefore(current, be) && isAfter(slotEnd, bs);
          });
          const gcalConflict = gcalEvents.some((e) => {
            const es = new Date(e.start);
            const ee = new Date(e.end);
            return isBefore(current, ee) && isAfter(slotEnd, es);
          });
          if (!isPast) {
            slots.push({
              time: format(current, "HH:mm"),
              available: !bookingConflict && !gcalConflict,
            });
          }
          current = addMinutes(current, 30);
        }
      }
      return slots;
    },
    enabled: !!selectedStaff && !!selectedDate && selectedServices.length > 0,
  });

  const toggleService = (serviceId: string) => {
    setSelectedServices((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId],
    );
  };

  const handleBook = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!validateSpamProtection(form)) {
      toast({ title: "Please wait a moment", description: "Then try submitting your booking again.", variant: "destructive" });
      return;
    }
    setBooking(true);
    const [h, m] = selectedTime.split(":").map(Number);
    const startTime = setMinutes(
      setHours(new Date(selectedDate + "T00:00:00"), h),
      m,
    );

    try {
      const { data, error } = await supabase.functions.invoke(
        "create-booking-checkout",
        {
          body: {
            organization_id: org!.id,
            location_id: selectedLocation,
            staff_id: selectedStaff,
            service_ids: selectedServices,
            customer_name: form.get("name") as string,
            customer_email: form.get("email") as string,
            customer_phone: form.get("phone") as string,
            start_time: startTime.toISOString(),
          },
        },
      );
      if (error) throw error;

      if (data.free) {
        setStep("confirmed");
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err: any) {
      toast({
        title: "Booking failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setBooking(false);
    }
  };

  if (isCancel) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="py-12 space-y-4">
            <CreditCard className="mx-auto h-16 w-16 text-muted-foreground" />
            <h2 className="text-2xl font-bold">Payment Cancelled</h2>
            <p className="text-muted-foreground">
              Your booking was not completed. You can try again.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (orgLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Salon not found.
      </div>
    );
  }

  if (step === "confirmed") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="py-12 space-y-4">
            <CheckCircle2 className="mx-auto h-16 w-16 text-primary" />
            <h2 className="text-2xl font-bold">Booking Confirmed!</h2>
            <p className="text-muted-foreground">
              You'll receive a confirmation email shortly.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const parsedSelectedDate = new Date(selectedDate + "T00:00:00");

  const embedTheme: EmbedTheme = org?.embed_theme && typeof org.embed_theme === "object"
    ? {
        primaryColor: (org.embed_theme as Record<string, unknown>).primaryColor as string ?? DEFAULT_EMBED_THEME.primaryColor,
        primaryColorOpacity: (org.embed_theme as Record<string, unknown>).primaryColorOpacity as number ?? undefined,
        primaryForegroundColor: (org.embed_theme as Record<string, unknown>).primaryForegroundColor as string ?? DEFAULT_EMBED_THEME.primaryForegroundColor,
        primaryForegroundColorOpacity: (org.embed_theme as Record<string, unknown>).primaryForegroundColorOpacity as number ?? undefined,
        backgroundColor: (org.embed_theme as Record<string, unknown>).backgroundColor as string ?? DEFAULT_EMBED_THEME.backgroundColor,
        backgroundColorOpacity: (org.embed_theme as Record<string, unknown>).backgroundColorOpacity as number ?? undefined,
        cardBackgroundColor: (org.embed_theme as Record<string, unknown>).cardBackgroundColor as string ?? DEFAULT_EMBED_THEME.cardBackgroundColor,
        cardBackgroundColorOpacity: (org.embed_theme as Record<string, unknown>).cardBackgroundColorOpacity as number ?? undefined,
        headingColor: (org.embed_theme as Record<string, unknown>).headingColor as string ?? DEFAULT_EMBED_THEME.headingColor,
        headingColorOpacity: (org.embed_theme as Record<string, unknown>).headingColorOpacity as number ?? undefined,
        bodyTextColor: (org.embed_theme as Record<string, unknown>).bodyTextColor as string ?? (org.embed_theme as Record<string, unknown>).textColor as string ?? DEFAULT_EMBED_THEME.bodyTextColor,
        bodyTextColorOpacity: (org.embed_theme as Record<string, unknown>).bodyTextColorOpacity as number ?? undefined,
        mutedTextColor: (org.embed_theme as Record<string, unknown>).mutedTextColor as string ?? DEFAULT_EMBED_THEME.mutedTextColor,
        mutedTextColorOpacity: (org.embed_theme as Record<string, unknown>).mutedTextColorOpacity as number ?? undefined,
        cardBorderColor: (org.embed_theme as Record<string, unknown>).cardBorderColor as string ?? DEFAULT_EMBED_THEME.cardBorderColor,
        cardBorderColorOpacity: (org.embed_theme as Record<string, unknown>).cardBorderColorOpacity as number ?? undefined,
        cardBorderWidth: typeof (org.embed_theme as Record<string, unknown>).cardBorderWidth === "number" ? (org.embed_theme as Record<string, unknown>).cardBorderWidth as number : DEFAULT_EMBED_THEME.cardBorderWidth,
        buttonBackgroundColor: (org.embed_theme as Record<string, unknown>).buttonBackgroundColor as string ?? DEFAULT_EMBED_THEME.buttonBackgroundColor,
        buttonTextColor: (org.embed_theme as Record<string, unknown>).buttonTextColor as string ?? DEFAULT_EMBED_THEME.buttonTextColor,
        buttonBorderColor: (org.embed_theme as Record<string, unknown>).buttonBorderColor as string ?? DEFAULT_EMBED_THEME.buttonBorderColor,
        buttonHoverBackgroundColor: (org.embed_theme as Record<string, unknown>).buttonHoverBackgroundColor as string ?? DEFAULT_EMBED_THEME.buttonHoverBackgroundColor,
        buttonHoverTextColor: (org.embed_theme as Record<string, unknown>).buttonHoverTextColor as string ?? DEFAULT_EMBED_THEME.buttonHoverTextColor,
        buttonActiveBackgroundColor: (org.embed_theme as Record<string, unknown>).buttonActiveBackgroundColor as string ?? DEFAULT_EMBED_THEME.buttonActiveBackgroundColor,
        buttonActiveTextColor: (org.embed_theme as Record<string, unknown>).buttonActiveTextColor as string ?? DEFAULT_EMBED_THEME.buttonActiveTextColor,
        buttonFocusRingColor: (org.embed_theme as Record<string, unknown>).buttonFocusRingColor as string ?? DEFAULT_EMBED_THEME.buttonFocusRingColor,
        inputBackgroundColor: (org.embed_theme as Record<string, unknown>).inputBackgroundColor as string ?? DEFAULT_EMBED_THEME.inputBackgroundColor,
        inputTextColor: (org.embed_theme as Record<string, unknown>).inputTextColor as string ?? DEFAULT_EMBED_THEME.inputTextColor,
        inputBorderColor: (org.embed_theme as Record<string, unknown>).inputBorderColor as string ?? DEFAULT_EMBED_THEME.inputBorderColor,
        inputPlaceholderColor: (org.embed_theme as Record<string, unknown>).inputPlaceholderColor as string ?? DEFAULT_EMBED_THEME.inputPlaceholderColor,
        summaryBackgroundColor: (org.embed_theme as Record<string, unknown>).summaryBackgroundColor as string ?? DEFAULT_EMBED_THEME.summaryBackgroundColor,
        summaryTitleColor: (org.embed_theme as Record<string, unknown>).summaryTitleColor as string ?? DEFAULT_EMBED_THEME.summaryTitleColor,
        summaryTextColor: (org.embed_theme as Record<string, unknown>).summaryTextColor as string ?? DEFAULT_EMBED_THEME.summaryTextColor,
        summaryBorderColor: (org.embed_theme as Record<string, unknown>).summaryBorderColor as string ?? DEFAULT_EMBED_THEME.summaryBorderColor,
        summarySeparatorColor: (org.embed_theme as Record<string, unknown>).summarySeparatorColor as string ?? DEFAULT_EMBED_THEME.summarySeparatorColor,
        stepPillCompletedColor: (org.embed_theme as Record<string, unknown>).stepPillCompletedColor as string ?? DEFAULT_EMBED_THEME.stepPillCompletedColor,
        stepPillCurrentColor: (org.embed_theme as Record<string, unknown>).stepPillCurrentColor as string ?? DEFAULT_EMBED_THEME.stepPillCurrentColor,
        stepPillDefaultColor: (org.embed_theme as Record<string, unknown>).stepPillDefaultColor as string ?? DEFAULT_EMBED_THEME.stepPillDefaultColor,
        customCss: typeof (org.embed_theme as Record<string, unknown>).customCss === "string" ? (org.embed_theme as Record<string, unknown>).customCss as string : "",
        textColor: (org.embed_theme as Record<string, unknown>).textColor as string ?? DEFAULT_EMBED_THEME.bodyTextColor,
        headingText: (org.embed_theme as Record<string, unknown>).headingText as string ?? DEFAULT_EMBED_THEME.headingText,
        subheadingText: (org.embed_theme as Record<string, unknown>).subheadingText as string ?? DEFAULT_EMBED_THEME.subheadingText,
      }
    : { ...DEFAULT_EMBED_THEME };

  const themeStyle: React.CSSProperties = {
    backgroundColor: embedTheme.backgroundColorOpacity != null && embedTheme.backgroundColorOpacity < 100
      ? hexToRgba(embedTheme.backgroundColor!, embedTheme.backgroundColorOpacity)
      : (embedTheme.backgroundColor ?? undefined),
    ["--primary" as string]: embedTheme.primaryColor ? hexToHslWithAlpha(embedTheme.primaryColor, embedTheme.primaryColorOpacity) : undefined,
    ["--primary-foreground" as string]: embedTheme.primaryForegroundColor ? hexToHslWithAlpha(embedTheme.primaryForegroundColor, embedTheme.primaryForegroundColorOpacity) : undefined,
    ["--card" as string]: embedTheme.cardBackgroundColor && (embedTheme.cardBackgroundColorOpacity == null || embedTheme.cardBackgroundColorOpacity >= 100)
      ? hexToHsl(embedTheme.cardBackgroundColor)
      : undefined,
    ["--card-foreground" as string]: embedTheme.headingColor ? hexToHslWithAlpha(embedTheme.headingColor, embedTheme.headingColorOpacity) : undefined,
    ["--foreground" as string]: embedTheme.bodyTextColor ? hexToHslWithAlpha(embedTheme.bodyTextColor, embedTheme.bodyTextColorOpacity) : (embedTheme.textColor ? hexToHsl(embedTheme.textColor) : undefined),
    ["--muted-foreground" as string]: embedTheme.mutedTextColor ? hexToHslWithAlpha(embedTheme.mutedTextColor, embedTheme.mutedTextColorOpacity) : undefined,
    ["--embed-button-bg" as string]: embedTheme.buttonBackgroundColor ?? undefined,
    ["--embed-button-fg" as string]: embedTheme.buttonTextColor ?? undefined,
    ["--embed-button-border" as string]: embedTheme.buttonBorderColor ?? undefined,
    ["--embed-button-hover-bg" as string]: embedTheme.buttonHoverBackgroundColor ?? undefined,
    ["--embed-button-hover-fg" as string]: embedTheme.buttonHoverTextColor ?? undefined,
    ["--embed-button-active-bg" as string]: embedTheme.buttonActiveBackgroundColor ?? undefined,
    ["--embed-button-active-fg" as string]: embedTheme.buttonActiveTextColor ?? undefined,
    ["--embed-button-focus-ring" as string]: embedTheme.buttonFocusRingColor ?? undefined,
    ["--embed-input-bg" as string]: embedTheme.inputBackgroundColor ?? undefined,
    ["--embed-input-fg" as string]: embedTheme.inputTextColor ?? undefined,
    ["--embed-input-border" as string]: embedTheme.inputBorderColor ?? undefined,
    ["--embed-input-placeholder" as string]: embedTheme.inputPlaceholderColor ?? undefined,
    ["--embed-summary-bg" as string]: embedTheme.summaryBackgroundColor ?? undefined,
    ["--embed-summary-title" as string]: embedTheme.summaryTitleColor ?? undefined,
    ["--embed-summary-fg" as string]: embedTheme.summaryTextColor ?? undefined,
    ["--embed-summary-border" as string]: embedTheme.summaryBorderColor ?? undefined,
    ["--embed-summary-separator" as string]: embedTheme.summarySeparatorColor ?? undefined,
  };
  const cardStyle: React.CSSProperties = {};
  if (embedTheme.cardBackgroundColor && embedTheme.cardBackgroundColorOpacity != null && embedTheme.cardBackgroundColorOpacity < 100) {
    cardStyle.backgroundColor = hexToRgba(embedTheme.cardBackgroundColor, embedTheme.cardBackgroundColorOpacity);
  }
  if (embedTheme.cardBorderColor) {
    cardStyle.borderColor = hexToRgba(embedTheme.cardBorderColor, embedTheme.cardBorderColorOpacity ?? 100);
  }
  if (embedTheme.cardBorderWidth != null && embedTheme.cardBorderWidth >= 0) {
    cardStyle.borderWidth = `${embedTheme.cardBorderWidth}px`;
  }

  return (
    <div
      className="embed-booking-widget flex min-h-screen items-center justify-center px-4 py-8"
      style={themeStyle}
    >
      <style>{`
        .embed-outline-btn {
          background-color: var(--embed-button-bg, #ffffff) !important;
          color: var(--embed-button-fg, #1f2937) !important;
          border-color: var(--embed-button-border, #e5e7eb) !important;
        }
        .embed-outline-btn:hover {
          background-color: var(--embed-button-hover-bg, #f3f4f6) !important;
          color: var(--embed-button-hover-fg, #111827) !important;
        }
        .embed-outline-btn:active {
          background-color: var(--embed-button-active-bg, #e5e7eb) !important;
          color: var(--embed-button-active-fg, #111827) !important;
        }
        .embed-outline-btn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px var(--embed-button-focus-ring, #7c3aed);
        }
        .embed-booking-widget input {
          background-color: var(--embed-input-bg, #ffffff) !important;
          color: var(--embed-input-fg, #1f2937) !important;
          border-color: var(--embed-input-border, #e5e7eb) !important;
        }
        .embed-booking-widget input::placeholder {
          color: var(--embed-input-placeholder, #9ca3af) !important;
        }
        .embed-booking-summary {
          background-color: var(--embed-summary-bg, #f9fafb) !important;
          color: var(--embed-summary-fg, #1f2937) !important;
          border-color: var(--embed-summary-border, #e5e7eb) !important;
        }
        .embed-booking-summary > p:first-child {
          color: var(--embed-summary-title, #6b7280) !important;
        }
        .embed-booking-summary .border-t {
          border-top-color: var(--embed-summary-separator, #e5e7eb) !important;
        }
      `}</style>
      {embedTheme.customCss?.trim() ? (
        <style dangerouslySetInnerHTML={{ __html: embedTheme.customCss.trim() }} />
      ) : null}
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Scissors className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold" style={{ color: embedTheme.headingColor ?? undefined }}>{org.name}</h1>
          <p className="text-sm text-muted-foreground">
            {embedTheme.headingText ?? "Book an appointment"}
          </p>
          <p className="text-xs text-muted-foreground">
            {embedTheme.subheadingText ?? "Choose your service and time"}
          </p>
        </div>

        <div className="flex items-center justify-center gap-1">
          {["location", "service", "staff", "time", "details"].map((s, i) => {
            const stepIndex = ["location", "service", "staff", "time", "details"].indexOf(step);
            const isCompleted = stepIndex > i;
            const isCurrent = stepIndex === i;
            const bgColor = isCurrent
              ? (embedTheme.stepPillCurrentColor ?? DEFAULT_EMBED_THEME.stepPillCurrentColor)
              : isCompleted
                ? (embedTheme.stepPillCompletedColor ?? DEFAULT_EMBED_THEME.stepPillCompletedColor)
                : (embedTheme.stepPillDefaultColor ?? DEFAULT_EMBED_THEME.stepPillDefaultColor);
            return (
              <div
                key={s}
                className="h-1.5 w-8 rounded-full"
                style={{ backgroundColor: bgColor }}
              />
            );
          })}
        </div>

        <Card style={Object.keys(cardStyle).length > 0 ? cardStyle : undefined}>
          {step === "location" && (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Select Location
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {locations.map((l) => (
                  <Button
                    key={l.id}
                    variant={selectedLocation === l.id ? "default" : "outline"}
                    className={`w-full justify-start ${selectedLocation !== l.id ? "embed-outline-btn" : ""}`}
                    onClick={() => {
                      setSelectedLocation(l.id);
                      setStep("service");
                    }}
                  >
                    {l.name}
                    {l.address && (
                      <span className="ml-auto text-xs opacity-60">
                        {l.address}
                      </span>
                    )}
                  </Button>
                ))}
                {locations.length === 0 && (
                  <p className="text-center text-muted-foreground py-4">
                    No locations available
                  </p>
                )}
              </CardContent>
            </>
          )}

          {step === "service" && (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Scissors className="h-5 w-5" />
                  Select Services
                </CardTitle>
                <CardDescription>Choose one or more services</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {services.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleService(s.id)}
                    className={`flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left text-sm transition-colors ${
                      selectedServices.includes(s.id)
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <Checkbox
                      checked={selectedServices.includes(s.id)}
                      onCheckedChange={() => toggleService(s.id)}
                      className="pointer-events-none"
                    />
                    <span className="flex-1 font-medium">{s.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {s.duration_minutes}min • ${Number(s.price).toFixed(2)}
                    </span>
                  </button>
                ))}

                {selectedServices.length > 0 && (
                  <div className="rounded-md bg-muted/50 px-4 py-2 text-sm flex justify-between">
                    <span>
                      {selectedServices.length} service
                      {selectedServices.length > 1 ? "s" : ""} • {totalDuration}
                      min total
                    </span>
                    <span className="font-semibold">
                      ${totalPrice.toFixed(2)}
                    </span>
                  </div>
                )}

                <Button
                  className="w-full"
                  disabled={selectedServices.length === 0}
                  onClick={() => setStep("staff")}
                >
                  Continue with {selectedServices.length} service
                  {selectedServices.length !== 1 ? "s" : ""}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full embed-outline-btn"
                  onClick={() => setStep("location")}
                >
                  ← Back
                </Button>
              </CardContent>
            </>
          )}

          {step === "staff" && (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Select Staff
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {staffList.map((s: any) => (
                  <Button
                    key={s.id}
                    variant={selectedStaff === s.id ? "default" : "outline"}
                    className={`w-full justify-start ${selectedStaff !== s.id ? "embed-outline-btn" : ""}`}
                    onClick={() => {
                      setSelectedStaff(s.id);
                      setStep("time");
                    }}
                  >
                    {s.name}
                  </Button>
                ))}
                {staffList.length === 0 && (
                  <p className="text-center text-muted-foreground py-4">
                    No staff at this location.
                  </p>
                )}
                <Button
                  variant="ghost"
                  className="w-full embed-outline-btn"
                  onClick={() => setStep("service")}
                >
                  ← Back
                </Button>
              </CardContent>
            </>
          )}

          {step === "time" && (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Select Date & Time
                </CardTitle>
                <CardDescription>
                  Total duration: {totalDuration} minutes
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-4">
                  {/* Left column: Calendar */}
                  <div className="shrink-0">
                    <CalendarWidget
                      mode="single"
                      selected={parsedSelectedDate}
                      onSelect={(date) => {
                        if (date) setSelectedDate(format(date, "yyyy-MM-dd"));
                      }}
                      disabled={(date) =>
                        isBefore(date, new Date(new Date().toDateString())) ||
                        (staffAvailDays.length > 0 &&
                          !staffAvailDays.includes(date.getDay()))
                      }
                      className="rounded-md border"
                      classNames={{
                        cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-primary/50 [&:has([aria-selected])]:bg-primary first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
                        day_selected:
                          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                        day_today: "ring-2 ring-primary ring-inset",
                      }}
                    />
                  </div>

                  {/* Right column: Time slots */}
                  <div className="flex-1 overflow-y-auto max-h-[300px]">
                    <p className="text-sm font-medium text-muted-foreground mb-2">
                      {format(parsedSelectedDate, "EEEE, MMMM d")}
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {timeSlots
                        .filter((t) => t.available)
                        .map((t) => (
                          <Button
                            key={t.time}
                            variant={
                              selectedTime === t.time ? "default" : "outline"
                            }
                            size="sm"
                            className={selectedTime !== t.time ? "embed-outline-btn" : ""}
                            onClick={() => {
                              setSelectedTime(t.time);
                              setStep("details");
                            }}
                          >
                            {t.time}
                          </Button>
                        ))}
                    </div>
                    {timeSlots.filter((t) => t.available).length === 0 && (
                      <p className="text-center text-muted-foreground py-8 text-sm">
                        No slots available for this date.
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  className="w-full embed-outline-btn"
                  onClick={() => setStep("staff")}
                >
                  ← Back
                </Button>
              </CardContent>
            </>
          )}

          {step === "details" && (
            <>
              <CardHeader>
                <CardTitle>Your Details</CardTitle>
                <CardDescription className="flex items-center gap-1">
                  <CreditCard className="h-4 w-4" />
                  {totalPrice > 0
                    ? `Payment of $${totalPrice.toFixed(2)} required for ${selectedServices.length} service${selectedServices.length > 1 ? "s" : ""}`
                    : "Free services — no payment needed"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleBook} className="space-y-4">
                  <SpamProtectionFields {...SpamProtectionFieldsProps} />
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                    className="!shadow-none !outline-none !ring-0"
                      name="name"
                      required
                      placeholder="Your name"
                      maxLength={100}
                      minLength={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                    className="!shadow-none !outline-none !ring-0"
                      name="email"
                      type="email"
                      required
                      placeholder="you@example.com"
                      maxLength={255}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input
                    className="!shadow-none !outline-none !ring-0"
                      name="phone"
                      placeholder="+1 234 567 890"
                      maxLength={20}
                      pattern="[\+\d\s\-\(\)]*"
                      title="Enter a valid phone number"
                    />
                  </div>

                  {/* Summary */}
                  <div className="embed-booking-summary rounded-md border p-3 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      Booking Summary
                    </p>
                    {selectedServiceObjects.map((s) => (
                      <div key={s.id} className="flex justify-between text-sm">
                        <span>
                          {s.name} ({s.duration_minutes}min)
                        </span>
                        <span>${Number(s.price).toFixed(2)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-sm font-semibold border-t pt-1 mt-1">
                      <span>Total ({totalDuration}min)</span>
                      <span>${totalPrice.toFixed(2)}</span>
                    </div>
                  </div>

                  <Button type="submit" className="w-full" disabled={booking}>
                    {booking && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {totalPrice > 0 ? `Book Now` : "Confirm Booking"}
                    {/* {totalPrice > 0 ? `Pay $${totalPrice.toFixed(2)} & Book` : "Confirm Booking"} */}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full embed-outline-btn"
                    onClick={() => setStep("time")}
                  >
                    ← Back
                  </Button>
                </form>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
