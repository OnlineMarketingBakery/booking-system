import { useState, useEffect, useMemo } from "react";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useSpamProtection } from "@/hooks/useSpamProtection";
import { SpamProtectionFields } from "@/components/SpamProtectionFields";
import { PhoneInput } from "@/components/PhoneInput";
import {
  Scissors,
  Loader2,
  CheckCircle2,
  Calendar,
  MapPin,
  Clock,
  CreditCard,
} from "lucide-react";
import {
  format,
  addMinutes,
  addDays,
  isBefore,
  isAfter,
} from "date-fns";
import { Day } from "react-day-picker";
import { DEFAULT_EMBED_THEME, hexToHsl, hexToHslWithAlpha, hexToRgba, getContrastingTextColors } from "@/types/embedTheme";
import type { EmbedTheme } from "@/types/embedTheme";
import { getHolidayDatesForYears, getHolidaysWithNames } from "@/lib/holidays";
import {
  isWallIntervalAvailableForBooking,
  wallIntervalsOverlap,
  type OccupancyRow,
} from "@/lib/slotStartCapacity";
import { BOOKING_SLOT_GRID_MINUTES } from "@/lib/bookingSlotConstants";
import { getErrorMessage } from "@/lib/errorMessage";
import { AddToCalendarButtons } from "@/components/AddToCalendarButtons";
import type { CalendarEventInput } from "@/lib/calendarLinks";
import {
  civilCalendarDayOfWeek,
  formatInOrgTz,
  getOrgIanaTimezone,
  orgLocalDayRangeUtcIso,
  orgWallDateTimeToUtc,
} from "@/lib/orgTimezone";

const WIDGET_BOOKING_CAL_KEY = "salonora_widget_booking_cal_v1";

function persistWidgetBookingCal(payload: {
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
}) {
  try {
    sessionStorage.setItem(WIDGET_BOOKING_CAL_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function readStoredWidgetCal(): CalendarEventInput | null {
  try {
    const raw = sessionStorage.getItem(WIDGET_BOOKING_CAL_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as {
      title: string;
      description?: string;
      location?: string;
      start: string;
      end: string;
    };
    return {
      title: j.title,
      description: j.description,
      location: j.location,
      start: new Date(j.start),
      end: new Date(j.end),
    };
  } catch {
    return null;
  }
}

function eligibleStaffIdsForWallSlot(
  activeStaffAtLocation: Set<string>,
  staffOnlyBreaks: { start_time: string; end_time: string; organization_break_slot_staff?: { staff_id: string }[] }[],
  orgYmd: string,
  orgTz: string,
  slotUtcStart: Date,
  slotUtcEnd: Date,
): string[] {
  return [...activeStaffAtLocation].filter((sid) =>
    !staffOnlyBreaks.some((brk) => {
      const ids = (brk.organization_break_slot_staff ?? []).map((x) => x.staff_id);
      if (!ids.includes(sid)) return false;
      const bs = orgWallDateTimeToUtc(orgYmd, brk.start_time.slice(0, 5), orgTz);
      const be = orgWallDateTimeToUtc(orgYmd, brk.end_time.slice(0, 5), orgTz);
      return slotUtcStart.getTime() < be.getTime() && slotUtcEnd.getTime() > bs.getTime();
    }),
  );
}

/** Subtract closure time windows from availability windows; returns list of open intervals (each { start_time, end_time } as HH:mm). */
function subtractClosureWindows(
  windows: { start_time: string; end_time: string }[],
  closures: { start_time: string; end_time: string }[]
): { start_time: string; end_time: string }[] {
  let result = windows.map((w) => ({
    start_time: w.start_time.slice(0, 5),
    end_time: w.end_time.slice(0, 5),
  }));
  for (const c of closures) {
    const cStart = c.start_time.slice(0, 5);
    const cEnd = c.end_time.slice(0, 5);
    const next: { start_time: string; end_time: string }[] = [];
    for (const r of result) {
      if (cEnd <= r.start_time || cStart >= r.end_time) {
        next.push(r);
        continue;
      }
      if (r.start_time < cStart) next.push({ start_time: r.start_time, end_time: cStart });
      if (cEnd < r.end_time) next.push({ start_time: cEnd, end_time: r.end_time });
    }
    result = next;
  }
  return result;
}

type Step = "location" | "service" | "time" | "details" | "confirmed" | "confirm_email_sent";

export default function BookingPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  /** Public widget: honeypot only — avoid a minimum delay that blocks fast legitimate checkouts. */
  const { validateSpamProtection, SpamProtectionFieldsProps } = useSpamProtection({ minSeconds: 0 });
  const [step, setStep] = useState<Step>("location");
  const [selectedLocation, setSelectedLocation] = useState<string>("");
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [selectedTime, setSelectedTime] = useState<string>("");
  /** UTC instant for the chosen slot; display label is `selectedTime` in the viewer's local zone. */
  const [selectedSlotStartMs, setSelectedSlotStartMs] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(
    format(new Date(), "yyyy-MM-dd"),
  );
  const [customerPhone, setCustomerPhone] = useState("");
  const [saveMyInfo, setSaveMyInfo] = useState(false);
  const [booking, setBooking] = useState(false);
  const [customerFirstName, setCustomerFirstName] = useState("");
  const [customerLastName, setCustomerLastName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");

  const bookingIdFromUrl = searchParams.get("booking_id");
  const isSuccess = window.location.pathname.includes("/book/success");
  const isCancel = window.location.pathname.includes("/book/cancel");
  const isPreviewMode = !!searchParams.get("preview_theme");

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
        .select("id, name, slug, logo_url, embed_theme, holiday_region, owner_default_staff_id, timezone")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!slug && !isSuccess && !isCancel,
  });

  const adminRegion = (org as { holiday_region?: string } | null)?.holiday_region ?? "NL";
  const orgTz = useMemo(() => getOrgIanaTimezone(org), [org]);

  useEffect(() => {
    setSelectedTime("");
    setSelectedSlotStartMs(null);
  }, [selectedDate]);

  const { data: holidayOverrides = [] } = useQuery({
    queryKey: ["booking-holiday-overrides", org?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_holiday_overrides")
        .select("date, is_working_day")
        .eq("organization_id", org!.id);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        date: (r.date as string).slice(0, 10),
        is_working_day: r.is_working_day,
      }));
    },
    enabled: !!org?.id,
  });

  const { data: offDaysList = [] } = useQuery({
    queryKey: ["booking-off-days", org?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_off_days")
        .select("date, reason, location_id")
        .eq("organization_id", org!.id);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        date: (r.date as string).slice(0, 10),
        reason: (r as { reason?: string | null }).reason ?? null,
        location_id: (r as { location_id?: string | null }).location_id ?? null,
      }));
    },
    enabled: !!org?.id,
  });

  // Off days that apply to the selected location: org-wide (location_id null) or this location
  const offDaysSet = useMemo(() => {
    const set = new Set<string>();
    offDaysList.forEach((o) => {
      if (o.location_id === null || o.location_id === selectedLocation) set.add(o.date);
    });
    return set;
  }, [offDaysList, selectedLocation]);
  const offDayReasonMap = useMemo(() => {
    const m = new Map<string, string>();
    offDaysList.forEach((o) => {
      if (o.location_id === null || o.location_id === selectedLocation)
        m.set(o.date, o.reason?.trim() || "Closed");
    });
    return m;
  }, [offDaysList, selectedLocation]);
  const holidayWorkingOverrideSet = useMemo(
    () => new Set(holidayOverrides.filter((o) => o.is_working_day).map((o) => o.date)),
    [holidayOverrides]
  );
  const holidayYears = useMemo(() => {
    const y = new Date().getFullYear();
    return [y, y + 1];
  }, []);
  const holidayNameMap = useMemo(() => {
    const entries = getHolidaysWithNames(adminRegion, holidayYears);
    return new Map(entries.map((e) => [e.date, e.name ?? "Public holiday"]));
  }, [adminRegion, holidayYears]);
  const holidayDatesSet = useMemo(
    () => new Set(getHolidayDatesForYears(adminRegion, holidayYears)),
    [adminRegion, holidayYears]
  );

  const isOffDay = useMemo(() => {
    return (date: Date) => {
      const dateStr = format(date, "yyyy-MM-dd");
      if (offDaysSet.has(dateStr)) return true;
      if (holidayDatesSet.has(dateStr) && !holidayWorkingOverrideSet.has(dateStr)) return true;
      return false;
    };
  }, [offDaysSet, holidayDatesSet, holidayWorkingOverrideSet]);

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

  // When there's only one location, select it and skip the location step
  useEffect(() => {
    if (locations.length === 1 && locations[0]?.id) {
      setSelectedLocation(locations[0].id);
      setStep("service");
    }
  }, [locations]);

  // Pre-fill details from localStorage when entering details step (user had previously checked "Save my information")
  const BOOKING_STORAGE_KEY = "booking_saved";
  useEffect(() => {
    if (step !== "details" || !org?.id) return;
    try {
      const raw = localStorage.getItem(`${BOOKING_STORAGE_KEY}_${org.id}`);
      if (!raw) return;
      const saved = JSON.parse(raw) as { customerFirstName?: string; customerLastName?: string; customerEmail?: string; customerPhone?: string };
      if (!saved || typeof saved !== "object") return;
      setCustomerFirstName((prev) => (prev.trim() ? prev : (saved.customerFirstName ?? "")));
      setCustomerLastName((prev) => (prev.trim() ? prev : (saved.customerLastName ?? "")));
      setCustomerEmail((prev) => (prev.trim() ? prev : (saved.customerEmail ?? "")));
      setCustomerPhone((prev) => (prev.trim() ? prev : (saved.customerPhone ?? "")));
    } catch {
      // ignore invalid or missing localStorage
    }
  }, [step, org?.id]);

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

  const CURRENCY_SYMBOLS: Record<string, string> = {
    usd: "$", eur: "€", gbp: "£", cad: "C$", aud: "A$", jpy: "¥", inr: "₹", brl: "R$",
  };
  const getCurrencySymbol = (code: string) => CURRENCY_SYMBOLS[code?.toLowerCase()] ?? code?.toUpperCase() ?? "€";

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
  const displayCurrency = selectedServiceObjects[0]?.currency ?? "eur";
  const currencySymbol = getCurrencySymbol(displayCurrency);

  // Fetch which days of week the location is open (for calendar disabling)
  const { data: locationAvailDays = [] } = useQuery({
    queryKey: ["booking-location-avail-days", selectedLocation],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("location_availability")
        .select("day_of_week")
        .eq("location_id", selectedLocation);
      if (error) throw error;
      return [...new Set(data.map((r) => r.day_of_week))];
    },
    enabled: !!selectedLocation,
  });

  const getOffDayReason = useMemo(() => {
    return (date: Date): string | null => {
      const dateStr = format(date, "yyyy-MM-dd");
      if (isBefore(date, new Date(new Date().toDateString()))) return "Past date";
      const dow = civilCalendarDayOfWeek(dateStr);
      if (locationAvailDays.length > 0 && !locationAvailDays.includes(dow))
        return "De locatie is vandaag gesloten.";
      if (offDayReasonMap.has(dateStr)) return offDayReasonMap.get(dateStr)!;
      if (holidayDatesSet.has(dateStr) && !holidayWorkingOverrideSet.has(dateStr))
        return `Feestdag: ${holidayNameMap.get(dateStr) ?? "Vakantie"}`;
      return null;
    };
  }, [locationAvailDays, offDayReasonMap, holidayDatesSet, holidayWorkingOverrideSet, holidayNameMap]);

  const ownerDefaultStaffId =
    (org as { owner_default_staff_id?: string | null } | null)?.owner_default_staff_id ?? null;

  const { data: timeSlots = [] } = useQuery({
    queryKey: [
      "booking-slots",
      org?.id,
      orgTz,
      ownerDefaultStaffId,
      selectedLocation,
      selectedDate,
      selectedServices,
      holidayOverrides,
      offDaysList,
      adminRegion,
    ],
    queryFn: async () => {
      const dateStr = selectedDate;
      if (offDaysSet.has(dateStr)) return [];
      const holidayDatesForRegion = getHolidayDatesForYears(adminRegion, holidayYears);
      const isWorkingOverride = holidayOverrides.some((o) => o.date === dateStr && o.is_working_day);
      if (holidayDatesForRegion.includes(dateStr) && !isWorkingOverride) return [];
      const dayOfWeek = civilCalendarDayOfWeek(dateStr);
      const { data: avail } = await supabase
        .from("location_availability")
        .select("*")
        .eq("location_id", selectedLocation)
        .eq("day_of_week", dayOfWeek);

      if (!avail || avail.length === 0) return [];

      const { data: closureRows = [] } = await supabase
        .from("location_closure_slots")
        .select("start_time, end_time")
        .eq("organization_id", org!.id)
        .eq("date", dateStr)
        .or(`location_id.is.null,location_id.eq.${selectedLocation}`);
      const closures = closureRows.map((r) => ({
        start_time: (r.start_time as string).slice(0, 5),
        end_time: (r.end_time as string).slice(0, 5),
      }));

      const { data: breakSlotRows = [] } = await supabase
        .from("organization_break_slots")
        .select("is_recurring, applies_date, start_time, end_time, applies_whole_salon, organization_break_slot_staff(staff_id)")
        .eq("organization_id", org!.id)
        .eq("location_id", selectedLocation);

      const applicableBreaks = (breakSlotRows as {
        is_recurring: boolean;
        applies_date: string | null;
        start_time: string;
        end_time: string;
        applies_whole_salon: boolean;
        organization_break_slot_staff: { staff_id: string }[] | null;
      }[]).filter((b) => b.is_recurring || (b.applies_date && (b.applies_date as string).slice(0, 10) === dateStr));

      const wholeSalonBreakClosures = applicableBreaks
        .filter((b) => b.applies_whole_salon)
        .map((b) => ({
          start_time: b.start_time.slice(0, 5),
          end_time: b.end_time.slice(0, 5),
        }));
      const staffOnlyBreaks = applicableBreaks.filter((b) => !b.applies_whole_salon);

      const { data: locStaffLinks = [] } = await supabase
        .from("staff_locations")
        .select("staff_id")
        .eq("location_id", selectedLocation);
      const locStaffIds = [...new Set(locStaffLinks.map((r) => r.staff_id))];
      let activeStaffAtLocation = new Set<string>();
      if (locStaffIds.length > 0) {
        const { data: activeRows } = await supabase
          .from("staff_public")
          .select("id")
          .in("id", locStaffIds)
          .eq("is_active", true);
        activeStaffAtLocation = new Set((activeRows ?? []).map((r) => r.id as string));
      }

      const closuresWithBreaks = [...closures, ...wholeSalonBreakClosures];
      const openWindows = subtractClosureWindows(
        avail.map((a) => ({ start_time: a.start_time, end_time: a.end_time })),
        closuresWithBreaks
      );
      if (openWindows.length === 0) return [];

      const { dayStart, dayEnd } = orgLocalDayRangeUtcIso(dateStr, orgTz);

      const { data: slotRows, error: slotErr } = await supabase.rpc(
        "get_location_booking_occupancy",
        {
          p_location_id: selectedLocation,
          p_range_start: dayStart,
          p_range_end: dayEnd,
          p_exclude_pending_token: null,
        },
      );
      if (slotErr) {
        console.error("[booking-slots] get_location_booking_occupancy:", slotErr);
      }
      const occupancyRows: OccupancyRow[] = (slotRows ?? []) as OccupancyRow[];

      let gcalEvents: { start: string; end: string }[] = [];
      try {
        const { data: gcalData } = await supabase.functions.invoke("fetch-gcal-events", {
          body: {
            organization_id: org!.id,
            time_min: dayStart,
            time_max: dayEnd,
          },
        });
        if (gcalData?.events) {
          gcalEvents = gcalData.events.map((e: { start: string; end: string }) => ({
            start: e.start,
            end: e.end,
          }));
        }
      } catch {
        // Silently ignore gcal fetch errors for public booking
      }

      const duration = totalDuration || 30;
      const slots: { time: string; startMs: number; available: boolean }[] = [];

      for (const a of openWindows) {
        let current = orgWallDateTimeToUtc(dateStr, a.start_time.slice(0, 5), orgTz);
        const openEnd = orgWallDateTimeToUtc(dateStr, a.end_time.slice(0, 5), orgTz);

        while (current.getTime() < openEnd.getTime()) {
          const slotEnd = addMinutes(current, duration);
          const fitsInWindow = slotEnd.getTime() <= openEnd.getTime();
          if (!fitsInWindow) {
            current = addMinutes(current, BOOKING_SLOT_GRID_MINUTES);
            continue;
          }
          const isPast = !isAfter(current, new Date());
          const breakFilteredReal = eligibleStaffIdsForWallSlot(
            activeStaffAtLocation,
            staffOnlyBreaks,
            dateStr,
            orgTz,
            current,
            slotEnd,
          );
          const eligibleForSlot =
            activeStaffAtLocation.size > 0
              ? breakFilteredReal
              : ownerDefaultStaffId
                ? [ownerDefaultStaffId]
                : [];
          const hasEligibleStaffForSlot = eligibleForSlot.length > 0;

          const intervalStartMs = current.getTime();
          const intervalEndMs = slotEnd.getTime();
          const bookingConflict =
            !hasEligibleStaffForSlot ||
            !isWallIntervalAvailableForBooking({
              rows: occupancyRows,
              intervalStartMs,
              intervalEndMs,
              eligibleStaffIds: eligibleForSlot,
              locationHasNoStaff: activeStaffAtLocation.size === 0 && !ownerDefaultStaffId,
              requestedStaffId: null,
            });
          // Owner primary calendar reflects one person's busy time — do not hide pooled slots for other stylists.
          const useGlobalGcalBlock = activeStaffAtLocation.size <= 1;
          const gcalConflict =
            useGlobalGcalBlock &&
            gcalEvents.some((e) => {
              const es = new Date(e.start).getTime();
              const ee = new Date(e.end).getTime();
              return wallIntervalsOverlap(intervalStartMs, intervalEndMs, es, ee);
            });
          const wallOverlapBreak = (bStart: string, bEnd: string) => {
            const bs = orgWallDateTimeToUtc(dateStr, bStart.slice(0, 5), orgTz);
            const be = orgWallDateTimeToUtc(dateStr, bEnd.slice(0, 5), orgTz);
            return current.getTime() < be.getTime() && slotEnd.getTime() > bs.getTime();
          };

          let staffBreakAllowsSlot = true;
          if (staffOnlyBreaks.length > 0 && activeStaffAtLocation.size > 0) {
            staffBreakAllowsSlot = [...activeStaffAtLocation].some((sid) =>
              !staffOnlyBreaks.some((brk) => {
                const ids = (brk.organization_break_slot_staff ?? []).map((x) => x.staff_id);
                if (!ids.includes(sid)) return false;
                return wallOverlapBreak(brk.start_time, brk.end_time);
              })
            );
          }

          if (!isPast) {
            slots.push({
              time: format(current, "HH:mm"),
              startMs: current.getTime(),
              available: !bookingConflict && !gcalConflict && staffBreakAllowsSlot,
            });
          }
          current = addMinutes(current, BOOKING_SLOT_GRID_MINUTES);
        }
      }
      return slots;
    },
    enabled: !!selectedLocation && !!selectedDate && selectedServices.length > 0 && !!org?.id,
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
    if (isPreviewMode) return;
    const form = new FormData(e.currentTarget);
    if (!validateSpamProtection(form)) {
      toast({ title: "Please wait a moment", description: "Then try submitting your booking again.", variant: "destructive" });
      return;
    }
    const phone = (customerPhone || ((form.get("phone") as string)?.trim() ?? "")).trim();
    if (!phone) {
      toast({ title: "Phone required", description: "Please enter your phone number.", variant: "destructive" });
      return;
    }
    const first = (customerFirstName || ((form.get("firstName") as string)?.trim() ?? "")).trim();
    const last = (customerLastName || ((form.get("lastName") as string)?.trim() ?? "")).trim();
    const fullName = [first, last].filter(Boolean).join(" ").trim();
    if (!fullName) {
      toast({ title: "Name required", description: "Please enter your first and last name.", variant: "destructive" });
      return;
    }
    setBooking(true);
    if (selectedSlotStartMs == null) {
      setBooking(false);
      toast({ title: "Select a time", description: "Please choose an available time slot.", variant: "destructive" });
      return;
    }
    const startTime = new Date(selectedSlotStartMs);
    const customerSlotTimeOrg = formatInOrgTz(startTime, orgTz, "HH:mm");

    try {
      const { data, error } = await supabase.functions.invoke(
        "request-booking-confirmation",
        {
          body: {
            organization_id: org!.id,
            location_id: selectedLocation,
            service_ids: selectedServices,
            customer_name: fullName,
            customer_email: (customerEmail || ((form.get("email") as string)?.trim() ?? "")).trim() || "",
            customer_phone: phone,
            start_time: startTime.toISOString(),
            customer_slot_date: selectedDate,
            customer_slot_time: customerSlotTimeOrg,
            save_my_info: saveMyInfo,
            region: adminRegion,
          },
        },
      );
      if (error) {
        setBooking(false);
        const d = data as { error?: string } | null | undefined;
        toast({
          title: "Boeking mislukt",
          description: d?.error?.trim() || getErrorMessage(error, "Request failed."),
          variant: "destructive",
        });
        return;
      }

      if (data.confirm_sent) {
        if (saveMyInfo && org?.id) {
          try {
            localStorage.setItem(
              `${BOOKING_STORAGE_KEY}_${org.id}`,
              JSON.stringify({
                customerFirstName: (customerFirstName || ((form.get("firstName") as string)?.trim() ?? "")).trim(),
                customerLastName: (customerLastName || ((form.get("lastName") as string)?.trim() ?? "")).trim(),
                customerEmail: (customerEmail || ((form.get("email") as string)?.trim() ?? "")).trim(),
                customerPhone: phone,
              })
            );
          } catch {
            // ignore
          }
        }
        const totalMin = selectedServiceObjects.reduce(
          (sum, s) => sum + (Number(s.duration_minutes) || 30),
          0,
        );
        const loc = locations.find((l) => l.id === selectedLocation);
        persistWidgetBookingCal({
          title: `${(org as { name?: string })?.name ?? "Salon"}: ${selectedServiceObjects.map((s) => s.name).join(", ")} (pending email confirmation)`,
          description:
            "Confirm your appointment using the link we sent to your email. This calendar entry is tentative until you confirm.",
          location: loc
            ? `${loc.name}${(loc as { address?: string | null }).address ? `, ${(loc as { address?: string | null }).address}` : ""}`
            : undefined,
          start: startTime.toISOString(),
          end: addMinutes(startTime, totalMin).toISOString(),
        });
        setStep("confirm_email_sent");
        return;
      }

      if (data.free) {
        if (saveMyInfo && org?.id) {
          try {
            localStorage.setItem(
              `${BOOKING_STORAGE_KEY}_${org.id}`,
              JSON.stringify({
                customerFirstName: (customerFirstName || ((form.get("firstName") as string)?.trim() ?? "")).trim(),
                customerLastName: (customerLastName || ((form.get("lastName") as string)?.trim() ?? "")).trim(),
                customerEmail: (customerEmail || ((form.get("email") as string)?.trim() ?? "")).trim(),
                customerPhone: phone,
              })
            );
          } catch {
            // ignore
          }
        }
        const totalMin = selectedServiceObjects.reduce(
          (sum, s) => sum + (Number(s.duration_minutes) || 30),
          0,
        );
        const loc = locations.find((l) => l.id === selectedLocation);
        persistWidgetBookingCal({
          title: `${(org as { name?: string })?.name ?? "Salon"}: ${selectedServiceObjects.map((s) => s.name).join(", ")}`,
          description: "Your appointment is confirmed.",
          location: loc
            ? `${loc.name}${(loc as { address?: string | null }).address ? `, ${(loc as { address?: string | null }).address}` : ""}`
            : undefined,
          start: startTime.toISOString(),
          end: addMinutes(startTime, totalMin).toISOString(),
        });
        setStep("confirmed");
        return;
      }

      if (data.url) {
        if (saveMyInfo && org?.id) {
          try {
            localStorage.setItem(
              `${BOOKING_STORAGE_KEY}_${org.id}`,
              JSON.stringify({
                customerFirstName: (customerFirstName || ((form.get("firstName") as string)?.trim() ?? "")).trim(),
                customerLastName: (customerLastName || ((form.get("lastName") as string)?.trim() ?? "")).trim(),
                customerEmail: (customerEmail || ((form.get("email") as string)?.trim() ?? "")).trim(),
                customerPhone: phone,
              })
            );
          } catch {
            // ignore
          }
        }
        window.location.href = data.url;
      }
    } catch (err: unknown) {
      toast({
        title: "Booking failed",
        description: getErrorMessage(err, "Something went wrong."),
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
    const cal = readStoredWidgetCal();
    const summaryLine =
      cal?.title?.includes(": ") ? cal.title.split(": ").slice(1).join(": ") : cal?.title ?? "Appointment";
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-8">
        <Card className="w-full max-w-lg border-primary/15 shadow-sm">
          <CardContent className="space-y-6 py-10 px-6 sm:px-10">
            <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <CheckCircle2 className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight">See you soon!</h2>
                <p className="text-muted-foreground text-sm">
                  Your appointment is confirmed. You will also receive a confirmation email with calendar links.
                </p>
              </div>
            </div>
            {cal ? (
              <div className="rounded-xl border bg-muted/40 p-4 sm:p-5">
                <div className="grid gap-4 sm:grid-cols-2 sm:divide-x sm:divide-border">
                  <div className="space-y-1 text-center sm:pr-4 sm:text-left">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">When</p>
                    <p className="text-lg font-semibold">{format(cal.start, "MMMM d")}</p>
                    <p className="text-sm text-muted-foreground">{format(cal.start, "EEEE")}</p>
                    <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground sm:justify-start">
                      <Clock className="h-4 w-4 shrink-0" />
                      {format(cal.start, "HH:mm")}
                      {" – "}
                      {format(cal.end, "HH:mm")}
                    </p>
                  </div>
                  <div className="space-y-1 text-center sm:pl-4 sm:text-left">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</p>
                    <p className="font-medium leading-snug">{summaryLine}</p>
                    {cal.location ? (
                      <p className="flex items-start justify-center gap-1.5 text-sm text-muted-foreground sm:justify-start">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                        {cal.location}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            {cal ? <AddToCalendarButtons event={cal} icsFileName="salon-appointment" /> : null}
            <div className="flex justify-center">
              <Button variant="outline" className="min-w-[200px]" onClick={() => window.location.reload()}>
                Book another appointment
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === "confirm_email_sent") {
    const cal = readStoredWidgetCal();
    const summaryLine =
      cal?.title?.includes(": ") ? cal.title.split(": ").slice(1).join(": ") : cal?.title ?? "Requested appointment";
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-8">
        <Card className="w-full max-w-lg border-primary/15 shadow-sm">
          <CardContent className="space-y-6 py-10 px-6 sm:px-10">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Calendar className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Check your email</h2>
              <p className="text-muted-foreground text-sm max-w-md">
                We have sent you a link to confirm your booking. Open the email and tap the button to complete your
                appointment. The link expires in 24 hours. Your confirmation email will include calendar options again
                once you confirm.
              </p>
            </div>
            {cal ? (
              <>
                <div className="rounded-xl border border-dashed bg-muted/30 p-4 sm:p-5">
                  <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Requested time (tentative)
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2 sm:divide-x sm:divide-border">
                    <div className="space-y-1 text-center sm:pr-4 sm:text-left">
                      <p className="text-lg font-semibold">{format(cal.start, "MMMM d")}</p>
                      <p className="text-sm text-muted-foreground">{format(cal.start, "EEEE")}</p>
                      <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground sm:justify-start">
                        <Clock className="h-4 w-4 shrink-0" />
                        {format(cal.start, "HH:mm")} – {format(cal.end, "HH:mm")}
                      </p>
                    </div>
                    <div className="space-y-1 text-center sm:pl-4 sm:text-left">
                      <p className="font-medium leading-snug">{summaryLine}</p>
                      {cal.location ? (
                        <p className="flex items-start justify-center gap-1.5 text-sm text-muted-foreground sm:justify-start">
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                          {cal.location}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
                <AddToCalendarButtons event={cal} icsFileName="salon-appointment-tentative" />
                <p className="text-center text-xs text-muted-foreground">
                  Optional reminder — your slot is held until you confirm by email.
                </p>
              </>
            ) : null}
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => window.location.reload()}>
                Back to booking
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const parsedSelectedDate = new Date(selectedDate + "T00:00:00");

  // Allow preview theme from URL (used by dashboard Embed page live preview)
  let themeSource: Record<string, unknown> | null = (org?.embed_theme as Record<string, unknown>) ?? null;
  const previewThemeParam = searchParams.get("preview_theme");
  if (previewThemeParam && org) {
    try {
      const parsed = JSON.parse(decodeURIComponent(previewThemeParam)) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") themeSource = parsed;
    } catch {
      // ignore invalid preview_theme
    }
  }

  const embedTheme: EmbedTheme = themeSource && typeof themeSource === "object"
    ? {
        primaryColor: (themeSource.primaryColor as string) ?? DEFAULT_EMBED_THEME.primaryColor,
        primaryColorOpacity: (themeSource.primaryColorOpacity as number) ?? undefined,
        primaryForegroundColor: (themeSource.primaryForegroundColor as string) ?? DEFAULT_EMBED_THEME.primaryForegroundColor,
        primaryForegroundColorOpacity: (themeSource.primaryForegroundColorOpacity as number) ?? undefined,
        backgroundColor: (themeSource.backgroundColor as string) ?? DEFAULT_EMBED_THEME.backgroundColor,
        backgroundColorOpacity: (themeSource.backgroundColorOpacity as number) ?? undefined,
        cardBackgroundColor: (themeSource.cardBackgroundColor as string) ?? DEFAULT_EMBED_THEME.cardBackgroundColor,
        cardBackgroundColorOpacity: (themeSource.cardBackgroundColorOpacity as number) ?? undefined,
        headingColor: (themeSource.headingColor as string) ?? DEFAULT_EMBED_THEME.headingColor,
        headingColorOpacity: (themeSource.headingColorOpacity as number) ?? undefined,
        bodyTextColor: (themeSource.bodyTextColor as string) ?? (themeSource.textColor as string) ?? DEFAULT_EMBED_THEME.bodyTextColor,
        bodyTextColorOpacity: (themeSource.bodyTextColorOpacity as number) ?? undefined,
        mutedTextColor: (themeSource.mutedTextColor as string) ?? DEFAULT_EMBED_THEME.mutedTextColor,
        mutedTextColorOpacity: (themeSource.mutedTextColorOpacity as number) ?? undefined,
        cardBorderColor: (themeSource.cardBorderColor as string) ?? DEFAULT_EMBED_THEME.cardBorderColor,
        cardBorderColorOpacity: (themeSource.cardBorderColorOpacity as number) ?? undefined,
        cardBorderWidth: typeof themeSource.cardBorderWidth === "number" ? themeSource.cardBorderWidth : DEFAULT_EMBED_THEME.cardBorderWidth,
        buttonBackgroundColor: (themeSource.buttonBackgroundColor as string) ?? DEFAULT_EMBED_THEME.buttonBackgroundColor,
        buttonTextColor: (themeSource.buttonTextColor as string) ?? DEFAULT_EMBED_THEME.buttonTextColor,
        buttonBorderColor: (themeSource.buttonBorderColor as string) ?? DEFAULT_EMBED_THEME.buttonBorderColor,
        buttonHoverBackgroundColor: (themeSource.buttonHoverBackgroundColor as string) ?? DEFAULT_EMBED_THEME.buttonHoverBackgroundColor,
        buttonHoverTextColor: (themeSource.buttonHoverTextColor as string) ?? DEFAULT_EMBED_THEME.buttonHoverTextColor,
        buttonActiveBackgroundColor: (themeSource.buttonActiveBackgroundColor as string) ?? DEFAULT_EMBED_THEME.buttonActiveBackgroundColor,
        buttonActiveTextColor: (themeSource.buttonActiveTextColor as string) ?? DEFAULT_EMBED_THEME.buttonActiveTextColor,
        buttonFocusRingColor: (themeSource.buttonFocusRingColor as string) ?? DEFAULT_EMBED_THEME.buttonFocusRingColor,
        inputBackgroundColor: (themeSource.inputBackgroundColor as string) ?? DEFAULT_EMBED_THEME.inputBackgroundColor,
        inputTextColor: (themeSource.inputTextColor as string) ?? DEFAULT_EMBED_THEME.inputTextColor,
        inputBorderColor: (themeSource.inputBorderColor as string) ?? DEFAULT_EMBED_THEME.inputBorderColor,
        inputPlaceholderColor: (themeSource.inputPlaceholderColor as string) ?? DEFAULT_EMBED_THEME.inputPlaceholderColor,
        summaryBackgroundColor: (themeSource.summaryBackgroundColor as string) ?? DEFAULT_EMBED_THEME.summaryBackgroundColor,
        summaryTitleColor: (themeSource.summaryTitleColor as string) ?? DEFAULT_EMBED_THEME.summaryTitleColor,
        summaryTextColor: (themeSource.summaryTextColor as string) ?? DEFAULT_EMBED_THEME.summaryTextColor,
        summaryBorderColor: (themeSource.summaryBorderColor as string) ?? DEFAULT_EMBED_THEME.summaryBorderColor,
        summarySeparatorColor: (themeSource.summarySeparatorColor as string) ?? DEFAULT_EMBED_THEME.summarySeparatorColor,
        stepPillCompletedColor: (themeSource.stepPillCompletedColor as string) ?? DEFAULT_EMBED_THEME.stepPillCompletedColor,
        stepPillCurrentColor: (themeSource.stepPillCurrentColor as string) ?? DEFAULT_EMBED_THEME.stepPillCurrentColor,
        stepPillDefaultColor: (themeSource.stepPillDefaultColor as string) ?? DEFAULT_EMBED_THEME.stepPillDefaultColor,
        customCss: typeof themeSource.customCss === "string" ? themeSource.customCss : "",
        textColor: (themeSource.textColor as string) ?? DEFAULT_EMBED_THEME.bodyTextColor,
        headingText: (themeSource.headingText as string) ?? DEFAULT_EMBED_THEME.headingText,
        subheadingText: (themeSource.subheadingText as string) ?? DEFAULT_EMBED_THEME.subheadingText,
      }
    : { ...DEFAULT_EMBED_THEME };

  const cardBgHex = embedTheme.cardBackgroundColor ?? "#ffffff";
  const contrastingText = getContrastingTextColors(cardBgHex);

  const themeStyle: React.CSSProperties = {
    backgroundColor: "transparent",
    ["--primary" as string]: embedTheme.primaryColor ? hexToHslWithAlpha(embedTheme.primaryColor, embedTheme.primaryColorOpacity) : undefined,
    ["--primary-foreground" as string]: embedTheme.primaryForegroundColor ? hexToHslWithAlpha(embedTheme.primaryForegroundColor, embedTheme.primaryForegroundColorOpacity) : undefined,
    ["--card" as string]: embedTheme.cardBackgroundColor && (embedTheme.cardBackgroundColorOpacity == null || embedTheme.cardBackgroundColorOpacity >= 100)
      ? hexToHsl(embedTheme.cardBackgroundColor)
      : undefined,
    ["--card-foreground" as string]: hexToHsl(contrastingText.foreground),
    ["--foreground" as string]: hexToHsl(contrastingText.foreground),
    ["--muted-foreground" as string]: hexToHsl(contrastingText.muted),
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
    ["--embed-summary-title" as string]: contrastingText.muted,
    ["--embed-summary-fg" as string]: contrastingText.foreground,
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

  const bookingSteps = locations.length === 1
    ? (["service", "time", "details"] as const)
    : (["location", "service", "time", "details"] as const);
  const stepIndex = (bookingSteps as readonly Step[]).indexOf(step);

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
          box-shadow: 0 0 0 2px var(--embed-button-focus-ring, #3990f0);
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
        .embed-booking-widget .embed-booking-calendar tbody button:hover:not(:disabled):not([aria-selected="true"]) {
          background-color: hsl(var(--primary) / 0.25) !important;
          color: hsl(var(--primary)) !important;
        }
      `}</style>
      {embedTheme.customCss?.trim() ? (
        <style dangerouslySetInnerHTML={{ __html: embedTheme.customCss.trim() }} />
      ) : null}
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex flex-col items-center gap-2">
        <img
            src="/salonora-logo.png"
            alt="Salonora"
            className="max-w-[50%]"
          />
          <h1 className="text-xl font-bold" style={{ color: contrastingText.foreground }}>{org.name}</h1>
          <p className="text-sm text-muted-foreground">
            {embedTheme.headingText ?? "Book an appointment"}
          </p>
          <p className="text-xs text-muted-foreground">
            {embedTheme.subheadingText ?? "Choose your service and time"}
          </p>
        </div>

        <div className="flex items-center justify-center gap-1">
          {bookingSteps.map((s, i) => {
            const isCurrent = stepIndex === i;
            const primaryHex = embedTheme.primaryColor ?? DEFAULT_EMBED_THEME.primaryColor ?? "#3990F0";
            const pillStyle: React.CSSProperties = isCurrent
              ? { backgroundColor: primaryHex }
              : { backgroundColor: hexToRgba(primaryHex, 35) };
            return (
              <div
                key={s}
                className="h-1.5 w-8 rounded-full"
                style={pillStyle}
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
                  Selecteer Locatie
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
                    Geen locaties beschikbaar
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
                  Selecteer Diensten
                </CardTitle>
                <CardDescription>Kies een of meer diensten.</CardDescription>
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
                      {s.duration_minutes}min • {getCurrencySymbol((s as { currency?: string }).currency ?? "eur")}{Number(s.price).toFixed(2)}
                    </span>
                  </button>
                ))}

                {selectedServices.length > 0 && (
                  <div className="rounded-md bg-muted/50 px-4 py-2 text-sm flex justify-between">
                    <span>
                      {selectedServices.length} dienst
                      {selectedServices.length > 1 ? "en" : ""} • {totalDuration}
                      min total
                    </span>
                    <span className="font-semibold">
                      {currencySymbol}{totalPrice.toFixed(2)}
                    </span>
                  </div>
                )}

                <Button
                  className="w-full"
                  disabled={selectedServices.length === 0}
                  onClick={() => setStep("time")}
                >
                  Doorgaan met dienst{selectedServices.length !== 1 ? "en" : ""} {selectedServices.length}
                  
                </Button>
                {/* {staffList.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground">
                    No staff assigned to this location yet. You can still book — you’ll pick a date and time next.
                  </p>
                )} */}
                {locations.length > 1 && (
                  <Button
                    variant="ghost"
                    className="w-full embed-outline-btn"
                    onClick={() => setStep("location")}
                  >
                    ← Terug
                  </Button>
                )}
              </CardContent>
            </>
          )}

          {step === "time" && (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Selecteer Datum en tijd
                </CardTitle>
                <CardDescription>
                Totale duur: {totalDuration} minuten
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground max-w-md">
                  We tonen gecombineerde tijden. Een beschikbare medewerker wordt automatisch toegewezen.
                </p>
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
                        (locationAvailDays.length > 0 &&
                          !locationAvailDays.includes(civilCalendarDayOfWeek(format(date, "yyyy-MM-dd")))) ||
                        isOffDay(date)
                      }
                      components={{
                        Day: (dayProps) => {
                          const reason = getOffDayReason(dayProps.date);
                          const content = <Day {...dayProps} />;
                          if (reason) {
                            return (
                              <Tooltip delayDuration={200}>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex size-full cursor-not-allowed items-center justify-center [&_button]:pointer-events-none">
                                    {content}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-[220px]">
                                  {reason}
                                </TooltipContent>
                              </Tooltip>
                            );
                          }
                          return content;
                        },
                      }}
                      className="embed-booking-calendar rounded-md border"
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
                            key={t.startMs}
                            variant={
                              selectedSlotStartMs === t.startMs ? "default" : "outline"
                            }
                            size="sm"
                            className={selectedSlotStartMs !== t.startMs ? "embed-outline-btn" : ""}
                            onClick={() => {
                              setSelectedTime(t.time);
                              setSelectedSlotStartMs(t.startMs);
                              setStep("details");
                            }}
                          >
                            {t.time}
                          </Button>
                        ))}
                    </div>
                    {timeSlots.filter((t) => t.available).length === 0 && (
                      <p className="text-center text-muted-foreground py-8 text-sm">
                        {(() => {
                          const reason = getOffDayReason(parsedSelectedDate);
                          return reason
                            ? `${reason}`
                            : "Er zijn geen plaatsen meer beschikbaar voor deze datum.";
                        })()}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  className="w-full embed-outline-btn"
                  onClick={() => setStep("service")}
                >
                  ← Terug
                </Button>
              </CardContent>
            </>
          )}

          {step === "details" && (
            <>
              <CardHeader>
                <CardTitle>Uw gegevens</CardTitle>
                <CardDescription className="flex items-center gap-1">
                  <CreditCard className="h-4 w-4" />
                  {totalPrice > 0
                    ? `Betaling van ${currencySymbol}${totalPrice.toFixed(2)} vereist voor ${selectedServices.length} dienst${selectedServices.length > 1 ? "en" : ""}`
                    : "Gratis diensten — geen betaling vereist"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleBook} className="space-y-4">
                  <SpamProtectionFields {...SpamProtectionFieldsProps} />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Voornaam</Label>
                      <Input
                        className="!shadow-none !outline-none !ring-0"
                        name="firstName"
                        required
                        placeholder="Voornaam"
                        maxLength={50}
                        minLength={1}
                        value={customerFirstName}
                        onChange={(e) => setCustomerFirstName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Achternaam</Label>
                      <Input
                        className="!shadow-none !outline-none !ring-0"
                        name="lastName"
                        required
                        placeholder="Achternaam"
                        maxLength={50}
                        minLength={1}
                        value={customerLastName}
                        onChange={(e) => setCustomerLastName(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>E-mail</Label>
                    <Input
                    className="!shadow-none !outline-none !ring-0"
                      name="email"
                      type="email"
                      required
                      placeholder="je@voorbeeld.com"
                      maxLength={255}
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Telefoon *</Label>
                    <input type="hidden" name="phone" value={customerPhone} />
                    <PhoneInput
                      value={customerPhone}
                      onChange={setCustomerPhone}
                      className="!shadow-none"
                      placeholder="06 12345678"
                    />
                  </div>

                  

                  {/* Summary */}
                  <div className="embed-booking-summary rounded-md border p-3 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                    Boekingsoverzicht
                    </p>
                    {selectedServiceObjects.map((s) => (
                        <div key={s.id} className="flex justify-between text-sm">
                          <span>{s.name} ({s.duration_minutes}min)</span>
                          <span>{currencySymbol}{Number(s.price).toFixed(2)}</span>
                        </div>
                      ))}
                    <div className="flex justify-between text-sm font-semibold border-t pt-1 mt-1">
                      <span>Total ({totalDuration}min)</span>
                      <span>{currencySymbol}{totalPrice.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="saveMyInfo"
                      checked={saveMyInfo}
                      onCheckedChange={(c) => setSaveMyInfo(!!c)}
                      className="!shadow-none"
                    />
                    <Label htmlFor="saveMyInfo" className="text-sm font-normal cursor-pointer">
                    Bewaar mijn gegevens voor de volgende keer dat ik een afspraak maak.
                    </Label>
                  </div>

                  <Button type="submit" className="w-full" disabled={booking || isPreviewMode}>
                    {booking && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {isPreviewMode ? "Alleen voorbeeld" : totalPrice > 0 ? `Boek nu` : "Bevestig boeking"}
                    {/* {totalPrice > 0 ? `Pay $${totalPrice.toFixed(2)} & Book` : "Confirm Booking"} */}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full embed-outline-btn"
                    onClick={() => setStep("time")}
                  >
                    ← Terug
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
