import { useState, useMemo, useEffect, useRef, type CSSProperties } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/PhoneInput";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, ChevronLeft, ChevronRight, Calendar as CalendarIcon, Plus, ExternalLink, MapPin, Pencil, CalendarClock, Trash2 } from "lucide-react";
import {
  format,
  startOfWeek,
  addDays,
  addWeeks,
  subWeeks,
  isSameDay,
  setHours,
  setMinutes,
  startOfDay,
  isBefore,
  max,
  min,
  differenceInMinutes,
} from "date-fns";
import { toast } from "@/hooks/use-toast";
import {
  formatInOrgTz,
  getOrgIanaTimezone,
  orgDayKey,
  orgNowTimeHhmm,
  orgPickerDateAndTimeToUtc,
  utcToOrgLocalCalendarDate,
} from "@/lib/orgTimezone";

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8);
const CAL_START_HOUR = HOURS[0];
const CAL_END_HOUR = HOURS[HOURS.length - 1] + 1;
/** Pixel height of one hour row (must match Tailwind h-[80px] on hour cells). */
const HOUR_ROW_PX = 80;
/** Sub-hour grid: 15-minute row height (hour band / 4). */
const CAL_QUARTER_PX = HOUR_ROW_PX / 4;

const SNAP_MINUTES = 15;

/** Y offset from top of day column → minutes since midnight, snapped, clamped to visible band (end may be exactly CAL_END_HOUR). */
function snappedMinutesFromY(yPx: number): number {
  const bandMin = CAL_START_HOUR * 60;
  const bandMaxExclusive = CAL_END_HOUR * 60;
  const raw = bandMin + (yPx / HOUR_ROW_PX) * 60;
  const snapped = Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.max(bandMin, Math.min(snapped, bandMaxExclusive));
}

function dateFromDayMinutes(day: Date, minutesSinceMidnight: number): Date {
  const h = Math.floor(minutesSinceMidnight / 60);
  const m = minutesSinceMidnight % 60;
  return setMinutes(setHours(startOfDay(day), h), m);
}

function isBandMinuteInPast(day: Date, minutesSinceMidnight: number): boolean {
  return isBefore(dateFromDayMinutes(day, minutesSinceMidnight), new Date());
}

/** First 15m grid point at or after now (same calendar day only). */
function firstSnappedMinuteNotPast(day: Date): number | null {
  if (!isSameDay(day, new Date())) return null;
  const bandMin = CAL_START_HOUR * 60;
  const bandMaxExclusive = CAL_END_HOUR * 60;
  const now = new Date();
  const t = now.getHours() * 60 + now.getMinutes();
  const snapped = Math.ceil(t / SNAP_MINUTES) * SNAP_MINUTES;
  const v = Math.max(bandMin, snapped);
  if (v >= bandMaxExclusive) return null;
  return v;
}

/** Hairline every 15 minutes (full column height; hour borders stay stronger). */
const QUARTER_GRID_STYLE: CSSProperties = {
  backgroundImage: `repeating-linear-gradient(
    to bottom,
    transparent 0px,
    transparent ${CAL_QUARTER_PX - 1}px,
    rgba(71, 85, 105, 0.09) ${CAL_QUARTER_PX - 1}px,
    rgba(71, 85, 105, 0.09) ${CAL_QUARTER_PX}px
  )`,
};

function dayColumnTimeRange(day: Date) {
  const start = setMinutes(setHours(startOfDay(day), CAL_START_HOUR), 0);
  const end = setMinutes(setHours(startOfDay(day), CAL_END_HOUR), 0);
  return { start, end };
}

/** Whether the event should appear in this calendar day column and overlaps the visible time band. */
function slotBelongsToCalendarDay(day: Date, start: Date, end: Date): boolean {
  const day0 = startOfDay(day);
  const day1 = addDays(day0, 1);
  if (end <= day0 || start >= day1) return false;
  const { start: bandStart, end: bandEnd } = dayColumnTimeRange(day);
  const t0 = max([start, bandStart]);
  const t1 = min([end, bandEnd]);
  return t1 > t0;
}

/** Top offset and height in px for an event block inside the day column. */
function layoutEventBlock(eventStart: Date, eventEnd: Date, day: Date): { top: number; height: number } | null {
  const { start: colStart, end: colEnd } = dayColumnTimeRange(day);
  const day0 = startOfDay(day);
  const day1 = addDays(day0, 1);
  const t0Ms = Math.max(eventStart.getTime(), colStart.getTime(), day0.getTime());
  const t1Ms = Math.min(eventEnd.getTime(), colEnd.getTime(), day1.getTime());
  if (t1Ms <= t0Ms) return null;
  const msPerHour = 60 * 60 * 1000;
  const topPx = ((t0Ms - colStart.getTime()) / msPerHour) * HOUR_ROW_PX;
  const heightPx = Math.max(((t1Ms - t0Ms) / msPerHour) * HOUR_ROW_PX, 24);
  return { top: topPx, height: heightPx };
}

/** True if two [start, end) intervals overlap (touching endpoints do not count). */
function intervalsOverlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

type OverlapLaneItem = { key: string; startMs: number; endMs: number };

/**
 * Groups events that overlap in time and assigns horizontal lanes (0..n-1) so each
 * concurrent booking gets its own column within the overlap cluster.
 */
function assignOverlapLanes(items: OverlapLaneItem[]): Map<string, { lane: number; laneCount: number }> {
  const result = new Map<string, { lane: number; laneCount: number }>();
  const n = items.length;
  if (n === 0) return result;

  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (intervalsOverlapMs(items[i].startMs, items[i].endMs, items[j].startMs, items[j].endMs)) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  const visited = new Array(n).fill(false);

  for (let s = 0; s < n; s++) {
    if (visited[s]) continue;
    const comp: number[] = [];
    const stack = [s];
    visited[s] = true;
    while (stack.length) {
      const u = stack.pop()!;
      comp.push(u);
      for (const v of adj[u]) {
        if (!visited[v]) {
          visited[v] = true;
          stack.push(v);
        }
      }
    }

    comp.sort((a, b) => {
      const ds = items[a].startMs - items[b].startMs;
      if (ds !== 0) return ds;
      return items[b].endMs - items[a].endMs;
    });

    const colEnds: number[] = [];
    const laneByIdx = new Map<number, number>();

    for (const idx of comp) {
      const e = items[idx];
      let lane = -1;
      for (let c = 0; c < colEnds.length; c++) {
        if (colEnds[c] <= e.startMs) {
          lane = c;
          break;
        }
      }
      if (lane >= 0) {
        colEnds[lane] = e.endMs;
        laneByIdx.set(idx, lane);
      } else {
        colEnds.push(e.endMs);
        laneByIdx.set(idx, colEnds.length - 1);
      }
    }

    const laneCount = Math.max(1, colEnds.length);
    for (const idx of comp) {
      const lane = laneByIdx.get(idx) ?? 0;
      result.set(items[idx].key, { lane, laneCount });
    }
  }

  return result;
}

const BOOKING_STATUS_COLORS: Record<string, string> = {
  pending: "bg-warning/20 text-warning-foreground border-warning/30",
  confirmed: "bg-primary/20 text-primary border-primary/30",
  paid: "bg-success/20 text-success border-success/30",
  completed: "bg-success/20 text-success border-success/30",
  cancelled: "bg-destructive/20 text-destructive border-destructive/30",
  no_show: "bg-muted text-muted-foreground border-border",
};

/** Strong left edge = status (dominant); fill = same family with a small hue shift by service. */
const BOOKING_STATUS_LEFT: Record<string, string> = {
  pending: "border-l-amber-500",
  confirmed: "border-l-blue-600",
  paid: "border-l-emerald-600",
  completed: "border-l-teal-600",
  cancelled: "border-l-destructive",
  no_show: "border-l-muted-foreground",
};

const BOOKING_STATUS_BG: Record<string, { h: number; s: number; l: number }> = {
  pending: { h: 38, s: 90, l: 90 },
  confirmed: { h: 218, s: 76, l: 90 },
  paid: { h: 152, s: 52, l: 89 },
  completed: { h: 168, s: 46, l: 88 },
  cancelled: { h: 0, s: 72, l: 92 },
  no_show: { h: 220, s: 16, l: 90 },
};

/** Stable signed offset in [-spread, spread] from a string (for hue differentiation). */
function hashToSignedSpread(input: string | null | undefined, spread: number): number {
  if (!input || !String(input).trim()) return 0;
  const s = String(input).trim();
  let n = 2166136261;
  for (let i = 0; i < s.length; i++) {
    n ^= s.charCodeAt(i);
    n = Math.imul(n, 16777619);
  }
  const span = spread * 2 + 1;
  return (Math.abs(n) % span) - spread;
}

function wrapHue(h: number): number {
  const x = h % 360;
  return x < 0 ? x + 360 : x;
}

/** Staff shifts hue strongly; service adds a smaller second offset so same stylist / different service still differs. */
function bookingWeekBlockStyles(
  status: string | undefined,
  serviceId: string | null | undefined,
  staffId: string | null | undefined,
) {
  const st = status && BOOKING_STATUS_LEFT[status] ? status : "confirmed";
  const left = BOOKING_STATUS_LEFT[st] ?? BOOKING_STATUS_LEFT.confirmed;
  const base = BOOKING_STATUS_BG[st] ?? BOOKING_STATUS_BG.confirmed;
  const staffHue = hashToSignedSpread(staffId, 36);
  const serviceHue = hashToSignedSpread(serviceId, 14);
  const h = wrapHue(base.h + staffHue + serviceHue);
  const bg = `hsl(${h} ${base.s}% ${base.l}% / 0.94)`;
  const fg = `hsl(${h} ${Math.min(base.s + 24, 50)}% 22%)`;
  const edge = `hsl(${h} ${Math.min(base.s + 8, 36)}% 72% / 0.55)`;
  return {
    className: `rounded-none border-t border-r border-b-0 border-l-[4px] shadow-sm ${left}`,
    style: {
      backgroundColor: bg,
      color: fg,
      borderTopColor: edge,
      borderRightColor: edge,
    } as CSSProperties,
  };
}

const BOOKING_STATUS_OPTIONS = [
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No show" },
] as const;

type SlotSource = "booking" | "gcal";

function getSlotKey(s: { id: string; source: SlotSource }) {
  return `${s.source}-${s.id}`;
}

type CalendarSlot = {
  id: string;
  source: SlotSource;
  summary: string;
  start: string;
  end: string;
  bookingId?: string;
  locationId?: string;
  /** From Google Calendar private extendedProperties when the event was created/synced by this app. */
  organizationId?: string;
};

/** Only salon-synced GCal events carry organization_id (or legacy booking_id for this org); personal meetings do not. */
function isSalonOriginGcalSlot(s: CalendarSlot, currentOrganizationId: string): boolean {
  if (s.source !== "gcal") return true;
  if (!currentOrganizationId) return false;
  if (
    s.organizationId != null &&
    String(s.organizationId).length > 0 &&
    String(s.organizationId) === String(currentOrganizationId)
  ) {
    return true;
  }
  return false;
}

function collectSlotsForCalendarDay(
  day: Date,
  locationId: string,
  orgBookings: any[],
  gcalConnected: boolean,
  gcalEvents: any[],
  firstLocationId: string,
): CalendarSlot[] {
  const slots: CalendarSlot[] = [];

  if (gcalConnected) {
    const gcalSlots: CalendarSlot[] = [];
    for (const e of gcalEvents || []) {
      if (!e.start) continue;
      const eStart = new Date(e.start);
      const eEnd = new Date(e.end || e.start);
      if (!slotBelongsToCalendarDay(day, eStart, eEnd)) continue;
      if (locationId && e.location_id != null && String(e.location_id) !== String(locationId)) continue;
      if (
        locationId &&
        (e.location_id == null || e.location_id === "") &&
        firstLocationId &&
        String(locationId) !== String(firstLocationId)
      )
        continue;
      gcalSlots.push({
        id: e.id || `gcal-${e.start}`,
        source: "gcal",
        summary: e.summary || "Event",
        start: e.start,
        end: e.end || e.start,
        bookingId: e.booking_id || undefined,
        locationId: e.location_id ?? undefined,
        organizationId: e.organization_id ?? undefined,
      });
    }
    const gcalEventIdsShown = new Set(gcalSlots.map((s) => String(s.id)));

    const bookingsForThisLocation = locationId
      ? orgBookings.filter((b: any) => String(b.location_id) === String(locationId))
      : orgBookings;

    const dbSlots: CalendarSlot[] = [];
    for (const b of bookingsForThisLocation) {
      const start = new Date(b.start_time);
      const end = new Date(b.end_time);
      if (!slotBelongsToCalendarDay(day, start, end)) continue;
      if (b.gcal_event_id && gcalEventIdsShown.has(String(b.gcal_event_id))) continue;
      const svc = b.services as { name?: string } | null;
      const staffName = (b.staff as { name?: string } | null)?.name;
      dbSlots.push({
        id: b.id,
        source: "booking",
        summary: [b.customer_name, svc?.name, staffName].filter(Boolean).join(" · ") || "Booking",
        start: b.start_time,
        end: b.end_time,
      });
    }
    return [...gcalSlots, ...dbSlots];
  }

  const bookingsForThisLocation = locationId
    ? orgBookings.filter((b: any) => String(b.location_id) === String(locationId))
    : orgBookings;

  for (const b of bookingsForThisLocation) {
    const start = new Date(b.start_time);
    const end = new Date(b.end_time);
    if (!slotBelongsToCalendarDay(day, start, end)) continue;
    const svc = b.services as { name?: string } | null;
    const staffName = (b.staff as { name?: string } | null)?.name;
    slots.push({
      id: b.id,
      source: "booking",
      summary: [b.customer_name, svc?.name, staffName].filter(Boolean).join(" · ") || "Booking",
      start: b.start_time,
      end: b.end_time,
    });
  }
  return slots;
}

function resolveBookingForSlot(
  s: { source: SlotSource; id: string; bookingId?: string; start: string; locationId?: string },
  orgBookings: any[],
): any | null {
  if (s.source === "booking") {
    return orgBookings.find((b: any) => b.id === s.id) ?? null;
  }
  if (s.source === "gcal") {
    if (s.bookingId) return orgBookings.find((b: any) => b.id === s.bookingId) ?? null;
    const byGcal = orgBookings.find((b: any) => b.gcal_event_id === s.id);
    if (byGcal) return byGcal;
    if (s.start && s.locationId) {
      return (
        orgBookings.find(
          (b: any) =>
            String(b.location_id) === String(s.locationId) &&
            Math.abs(new Date(b.start_time).getTime() - new Date(s.start).getTime()) < 60000,
        ) ?? null
      );
    }
    return null;
  }
  return null;
}

type CalendarWeekGridProps = {
  weekDays: Date[];
  orgBookings: any[];
  gcalEvents: any[];
  gcalConnected: boolean;
  locationId: string;
  firstLocationId: string;
  organizationId: string;
  onAddBooking: (day: Date, hour: number) => void;
  onAddBookingRange: (day: Date, start: Date, end: Date) => void;
  onSelectBooking: (booking: any) => void;
  onSelectOrphanGcal: (ev: { id: string; summary: string; start: string; end: string }) => void;
};

function CalendarWeekGrid({
  weekDays,
  orgBookings,
  gcalEvents,
  gcalConnected,
  locationId,
  firstLocationId,
  organizationId,
  onAddBooking,
  onAddBookingRange,
  onSelectBooking,
  onSelectOrphanGcal,
}: CalendarWeekGridProps) {
  const slotDragRef = useRef<{
    dayKey: string;
    pointerId: number;
    startMin: number;
    curMin: number;
  } | null>(null);
  const [slotDragUi, setSlotDragUi] = useState<NonNullable<typeof slotDragRef.current> | null>(null);

  const flushDragFromPointer = (col: HTMLElement, e: PointerEvent) => {
    const d = slotDragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    slotDragRef.current = null;
    setSlotDragUi(null);
    try {
      col.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    const lo = Math.min(d.startMin, d.curMin);
    const hi = Math.max(d.startMin, d.curMin);
    const span = hi - lo;
    const day = weekDays.find((x) => format(x, "yyyy-MM-dd") === d.dayKey);
    if (!day) return;
    if (span < SNAP_MINUTES) {
      const hour = Math.floor(lo / 60);
      const cappedHour = Math.min(HOURS[HOURS.length - 1], Math.max(CAL_START_HOUR, hour));
      if (cappedHour >= CAL_START_HOUR && cappedHour <= HOURS[HOURS.length - 1]) {
        onAddBooking(day, cappedHour);
      }
    } else {
      onAddBookingRange(day, dateFromDayMinutes(day, lo), dateFromDayMinutes(day, hi));
    }
  };

  return (
    <div className="w-full min-w-0 overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[48px_repeat(7,minmax(0,1fr))] border-b-2 border-border bg-muted/50">
          <div className="shrink-0 border-r border-border bg-muted/70" aria-hidden />
          {weekDays.map((day) => {
            const isToday = isSameDay(day, new Date());
            return (
              <div
                key={day.toISOString()}
                className={`min-w-0 border-l border-border py-2 text-center shadow-[inset_0_-1px_0_0_rgba(15,23,42,0.08)] ${
                  isToday ? "bg-primary/[0.14]" : "bg-muted/20"
                }`}
              >
                <p
                  className={`text-[11px] font-medium leading-tight sm:text-xs ${
                    isToday ? "font-semibold text-primary" : "text-muted-foreground"
                  }`}
                >
                  {format(day, "EEE")}{" "}
                  <span className={isToday ? "text-primary" : "text-foreground"}>{format(day, "d")}</span>
                </p>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-[48px_repeat(7,minmax(0,1fr))] border-b border-border bg-background">
          <div
            className="relative flex shrink-0 flex-col border-r-2 border-border bg-muted/40"
            style={{ height: HOURS.length * HOUR_ROW_PX }}
          >
            <div className="pointer-events-none absolute inset-0 z-[1]" style={QUARTER_GRID_STYLE} aria-hidden />
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="relative z-[2] box-border shrink-0 border-b border-border/90 pr-1.5 pt-1 text-right text-[10px] font-medium tabular-nums text-muted-foreground sm:text-[11px]"
                style={{ height: HOUR_ROW_PX }}
              >
                {format(setHours(new Date(), hour), "h a")}
              </div>
            ))}
          </div>
          {weekDays.map((day) => {
            const slots = collectSlotsForCalendarDay(
              day,
              locationId,
              orgBookings,
              gcalConnected,
              gcalEvents,
              firstLocationId,
            );

            const overlapItems: OverlapLaneItem[] = [];
            for (const s of slots) {
              const endDate = new Date(s.end || s.start);
              const layout = layoutEventBlock(new Date(s.start), endDate, day);
              if (!layout) continue;
              let startMs = new Date(s.start).getTime();
              let endMs = new Date(s.end || s.start).getTime();
              if (endMs <= startMs) endMs = startMs + 60 * 1000;
              overlapItems.push({ key: getSlotKey(s), startMs, endMs });
            }
            const laneByKey = assignOverlapLanes(overlapItems);

            const dayKey = format(day, "yyyy-MM-dd");

            return (
              <div
                key={day.toISOString()}
                className={`relative min-w-0 select-none touch-manipulation border-l border-border bg-background ${
                  isSameDay(day, new Date()) ? "bg-primary/[0.06]" : ""
                }`}
                style={{ height: HOURS.length * HOUR_ROW_PX }}
                onPointerDownCapture={(e) => {
                  if (e.button !== 0) return;
                  if (slotDragRef.current) return;
                  const el = e.target as Element;
                  if (el.closest("[data-calendar-event]")) return;
                  const col = e.currentTarget;
                  const rect = col.getBoundingClientRect();
                  let y = e.clientY - rect.top;
                  y = Math.max(0, Math.min(rect.height - 1e-3, y));
                  let m = snappedMinutesFromY(y);
                  if (isBandMinuteInPast(day, m)) {
                    const fp = firstSnappedMinuteNotPast(day);
                    if (fp == null) return;
                    m = fp;
                  }
                  col.setPointerCapture(e.pointerId);
                  const payload = { dayKey, pointerId: e.pointerId, startMin: m, curMin: m };
                  slotDragRef.current = payload;
                  setSlotDragUi(payload);
                }}
                onPointerMove={(e) => {
                  const d = slotDragRef.current;
                  if (!d || e.pointerId !== d.pointerId || d.dayKey !== dayKey) return;
                  const col = e.currentTarget;
                  const rect = col.getBoundingClientRect();
                  let y = e.clientY - rect.top;
                  y = Math.max(0, Math.min(rect.height - 1e-3, y));
                  let m = snappedMinutesFromY(y);
                  const fp = firstSnappedMinuteNotPast(day);
                  if (fp != null) m = Math.max(m, fp);
                  d.curMin = m;
                  setSlotDragUi({ ...d });
                }}
                onPointerUp={(e) => {
                  const d = slotDragRef.current;
                  if (!d || d.dayKey !== dayKey) return;
                  flushDragFromPointer(e.currentTarget, e);
                }}
                onPointerCancel={(e) => {
                  const d = slotDragRef.current;
                  if (!d || d.dayKey !== dayKey) return;
                  slotDragRef.current = null;
                  setSlotDragUi(null);
                  try {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  } catch {
                    /* ok */
                  }
                }}
                onLostPointerCapture={() => {
                  slotDragRef.current = null;
                  setSlotDragUi(null);
                }}
              >
                <div className="pointer-events-none absolute inset-0 z-[1]" style={QUARTER_GRID_STYLE} aria-hidden />
                {HOURS.map((hour) => {
                  const slotTime = setMinutes(setHours(startOfDay(day), hour), 0);
                  const isPastSlot = isBefore(slotTime, new Date());
                  const top = (hour - CAL_START_HOUR) * HOUR_ROW_PX;
                  const isTodayCol = isSameDay(day, new Date());
                  return (
                    <div
                      key={hour}
                      role={isPastSlot ? undefined : "button"}
                      tabIndex={isPastSlot ? undefined : 0}
                      onKeyDown={
                        isPastSlot ? undefined : (e) => e.key === "Enter" && onAddBooking(day, hour)
                      }
                      style={{ top, height: HOUR_ROW_PX }}
                      className={`pointer-events-none absolute left-0 right-0 z-[2] box-border border-b border-border/90 p-1 ${
                        isPastSlot
                          ? "cursor-not-allowed bg-muted/30 opacity-70"
                          : "cursor-crosshair"
                      } ${isTodayCol && !isPastSlot ? "bg-primary/[0.07]" : ""} ${
                        isTodayCol && isPastSlot ? "bg-muted/25" : ""
                      }`}
                    />
                  );
                })}
                {slotDragUi?.dayKey === dayKey && (
                  <div
                    className="pointer-events-none absolute z-[25] rounded-sm border border-primary/50 bg-primary/20 left-0.5 right-0.5"
                    style={{
                      top: ((Math.min(slotDragUi.startMin, slotDragUi.curMin) - CAL_START_HOUR * 60) / 60) * HOUR_ROW_PX,
                      height: Math.max(
                        (SNAP_MINUTES / 60) * HOUR_ROW_PX,
                        (Math.abs(slotDragUi.curMin - slotDragUi.startMin) / 60) * HOUR_ROW_PX,
                      ),
                    }}
                    aria-hidden
                  />
                )}
                <div className="pointer-events-none absolute inset-0 z-[3] overflow-visible">
                  {slots.map((s) => {
                    const endDate = new Date(s.end || s.start);
                    const layout = layoutEventBlock(new Date(s.start), endDate, day);
                    if (!layout) return null;
                    const { lane, laneCount } = laneByKey.get(getSlotKey(s)) ?? {
                      lane: 0,
                      laneCount: 1,
                    };
                    const gapPx = 4;
                    const pct = 100 / laneCount;
                    const leftCalc = `calc(${lane * pct}% + ${gapPx / 2}px)`;
                    const widthCalc = `calc(${pct}% - ${gapPx}px)`;

                    const booking = resolveBookingForSlot(s, orgBookings);
                    const isManageable = !!booking;
                    const isOrphanGcal = s.source === "gcal" && !booking;
                    const orphanIsSalonScoped = isOrphanGcal && isSalonOriginGcalSlot(s, organizationId);
                    const isOtherGoogleEvent = isOrphanGcal && !orphanIsSalonScoped;
                    const isClickable = isManageable || orphanIsSalonScoped;
                    const tooltipContent = booking
                      ? `${booking.customer_name}${(booking.services as { name?: string })?.name ? ` · ${(booking.services as { name?: string }).name}` : ""}${(booking.staff as { name?: string })?.name ? ` · ${(booking.staff as { name?: string }).name}` : ""}\n${format(new Date(booking.start_time), "MMM d, h:mm a")} – ${format(new Date(booking.end_time), "h:mm a")}${booking.notes ? `\n${booking.notes}` : ""}`
                      : `${s.summary}\n${format(new Date(s.start), "MMM d, h:mm a")}${s.end ? ` – ${format(new Date(s.end), "h:mm a")}` : ""}`;
                    const weekBlock =
                      isManageable && booking
                        ? bookingWeekBlockStyles(
                            booking.status,
                            booking.service_id as string | null | undefined,
                            booking.staff_id as string | null | undefined,
                          )
                        : { className: "", style: undefined as CSSProperties | undefined };

                    const svcName = (booking?.services as { name?: string } | null)?.name;
                    const stfName = (booking?.staff as { name?: string } | null)?.name;
                    const cardInner =
                      isManageable && booking ? (
                        <>
                          <p className="min-h-0 truncate text-[11px] font-semibold leading-snug sm:text-xs">
                            {booking.customer_name?.trim() || s.summary}
                          </p>
                          <p className="min-h-0 truncate text-[10px] leading-snug text-foreground/70">
                            {format(new Date(s.start), "h:mm a")}
                            {s.end ? `–${format(new Date(s.end), "h:mm a")}` : ""}
                            {svcName ? ` · ${svcName}` : ""}
                            {stfName ? ` · ${stfName}` : ""}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="min-h-0 truncate text-[11px] font-medium leading-snug sm:text-xs">{s.summary}</p>
                          <p className="truncate text-[10px] leading-snug text-muted-foreground sm:text-[11px]">
                            {format(new Date(s.start), "h:mm a")}
                            {s.end ? ` · ${format(new Date(s.end), "h:mm a")}` : ""}
                          </p>
                        </>
                      );

                    const cardStyle = {
                      top: layout.top,
                      height: layout.height,
                      left: leftCalc,
                      width: widthCalc,
                    };

                    if (isOtherGoogleEvent) {
                      return (
                        <div
                          key={getSlotKey(s)}
                          title={`${s.summary} (${format(new Date(s.start), "MMM d, h:mm a")}) — Google only, not a salon booking`}
                          style={cardStyle}
                          className="pointer-events-none absolute box-border flex min-h-0 flex-col justify-start gap-0.5 overflow-hidden rounded-none border-t border-r border-b-0 border-l border-dashed border-muted-foreground/40 bg-muted/40 p-1.5 text-xs text-muted-foreground"
                        >
                          {cardInner}
                        </div>
                      );
                    }

                    return (
                      <Tooltip key={getSlotKey(s)} delayDuration={300}>
                        <TooltipTrigger asChild>
                          <div
                            data-calendar-event
                            role={isClickable ? "button" : undefined}
                            tabIndex={isClickable ? 0 : undefined}
                            style={{ ...cardStyle, ...(weekBlock.style ?? {}) }}
                            className={`pointer-events-auto absolute box-border flex min-h-0 flex-col justify-start gap-0.5 overflow-hidden rounded-none p-1.5 text-xs shadow-sm transition-opacity duration-150 ${
                              isManageable
                                ? `${weekBlock.className} cursor-pointer hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring`
                                : orphanIsSalonScoped
                                  ? "cursor-pointer rounded-none border-t border-r border-b-0 border-l border-border bg-muted transition-colors hover:bg-muted/85 focus:outline-none focus:ring-2 focus:ring-ring"
                                  : "rounded-none border-t border-r border-b-0 border-l border-border bg-muted"
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (booking) onSelectBooking(booking);
                              else if (orphanIsSalonScoped)
                                onSelectOrphanGcal({
                                  id: s.id,
                                  summary: s.summary,
                                  start: s.start,
                                  end: s.end || s.start,
                                });
                            }}
                            onKeyDown={(e) => {
                              if (isClickable && e.key === "Enter") {
                                e.stopPropagation();
                                if (booking) onSelectBooking(booking);
                                else if (orphanIsSalonScoped)
                                  onSelectOrphanGcal({
                                    id: s.id,
                                    summary: s.summary,
                                    start: s.start,
                                    end: s.end || s.start,
                                  });
                              }
                            }}
                          >
                            {cardInner}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          className="max-w-[min(22rem,calc(100vw-2rem))] whitespace-pre-line text-xs leading-relaxed shadow-md"
                        >
                          {tooltipContent}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const { organization } = useOrganization();
  const orgTimeZone = getOrgIanaTimezone(organization);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [addBookingOpen, setAddBookingOpen] = useState(false);
  const [slotStart, setSlotStart] = useState<Date | null>(null);
  const [slotEnd, setSlotEnd] = useState<Date | null>(null);
  const [refreshingAfterNavigate, setRefreshingAfterNavigate] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [selectedBooking, setSelectedBooking] = useState<any | null>(null);
  const [selectedOrphanGcalEvent, setSelectedOrphanGcalEvent] = useState<{ id: string; summary: string; start: string; end: string } | null>(null);

  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const rangeStart = weekDays[0].toISOString();
  const rangeEnd = addDays(weekDays[6], 1).toISOString();

  // Organization bookings for the week (include gcal_event_id to dedupe with Google Calendar)
  const {
    data: orgBookings = [],
    isLoading: bookingsLoading,
    refetch: refetchBookings,
  } = useQuery({
    queryKey: ["calendar-bookings", organization?.id, rangeStart, rangeEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*, service_id, services(name, duration_minutes), staff(name), locations(name), gcal_event_id")
        .eq("organization_id", organization!.id)
        .gte("start_time", rangeStart)
        .lt("start_time", rangeEnd)
        .order("start_time", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!organization,
    refetchOnWindowFocus: true,
    refetchInterval: 45 * 1000,
    staleTime: 0,
  });

  // Locations for tabs (each tab shows that location's calendar only)
  const { data: locations = [] } = useQuery({
    queryKey: ["locations", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name")
        .eq("organization_id", organization!.id)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organization,
  });

  // Default to first location when locations load
  useEffect(() => {
    if (locations.length > 0 && !selectedLocationId) {
      setSelectedLocationId(locations[0].id);
    }
    if (locations.length > 0 && selectedLocationId && !locations.some((l) => l.id === selectedLocationId)) {
      setSelectedLocationId(locations[0].id);
    }
  }, [locations, selectedLocationId]);

  // Resolve which location is active (for tabs and for Add booking default)
  const effectiveLocationId = selectedLocationId || locations[0]?.id;
  const firstLocationId = locations[0]?.id ?? "";

  // Check if Google Calendar is connected
  const { data: gcalConnected } = useQuery({
    queryKey: ["gcal-connected", user?.id],
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

  // Fetch Google Calendar events for the week
  const {
    data: gcalEvents = [],
    isLoading: gcalLoading,
    refetch: refetchGcal,
  } = useQuery({
    queryKey: ["gcal-events", organization?.id, user?.id, rangeStart],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("fetch-gcal-events", {
        body: {
          user_id: user!.id,
          organization_id: organization!.id,
          time_min: rangeStart,
          time_max: rangeEnd,
        },
      });
      if (error) throw error;
      const rec = data?.gcal_reconcile as { cancelled?: number } | undefined;
      if (rec && typeof rec.cancelled === "number" && rec.cancelled > 0) {
        void queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
      }
      return data?.events || [];
    },
    enabled: !!user && !!gcalConnected && !!organization?.id,
    refetchOnWindowFocus: true,
    refetchInterval: 45 * 1000,
    staleTime: 0,
  });

  // When user navigates back to calendar, refetch so we never show stale duplicates
  useEffect(() => {
    if (!organization) return;
    setRefreshingAfterNavigate(true);
    const p1 = refetchBookings();
    const p2 = gcalConnected ? refetchGcal() : Promise.resolve();
    Promise.all([p1, p2]).finally(() => setRefreshingAfterNavigate(false));
  }, [organization?.id, gcalConnected]);

  const openAddBooking = (day?: Date, hour?: number) => {
    setSlotEnd(null);
    if (day != null && hour != null) {
      const start = setMinutes(setHours(startOfDay(day), hour), 0);
      setSlotStart(start);
    } else {
      const now = new Date();
      const nextHour = now.getHours() + 1;
      setSlotStart(setMinutes(setHours(startOfDay(now), nextHour > 23 ? 0 : nextHour), 0));
    }
    setAddBookingOpen(true);
  };

  const openAddBookingRange = (day: Date, start: Date, end: Date) => {
    setSlotStart(start);
    setSlotEnd(end);
    setAddBookingOpen(true);
  };

  const closeAddBooking = () => {
    setAddBookingOpen(false);
    setSlotStart(null);
    setSlotEnd(null);
  };

  const isInitialLoading = bookingsLoading || (!!gcalConnected && gcalLoading);
  const hasCachedData = orgBookings.length > 0 || (!!gcalConnected && gcalEvents.length > 0);
  // When we have cache and just navigated back, show loading until refetch completes so we never flash duplicates
  const isLoading = isInitialLoading || (hasCachedData && refreshingAfterNavigate);

  const handleConnectGoogle = () => {
    const redirectUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-auth-callback?action=login&state=${user?.id}`;
    window.location.href = redirectUrl;
  };

  return (
    <>
      <div className="space-y-3">
        <header className="pb-0 sm:pb-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="flex min-w-0 items-start gap-2.5 sm:items-center">
              <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary sm:mt-0 sm:h-9 sm:w-9">
                <CalendarIcon className="h-4 w-4 sm:h-[18px] sm:w-[18px]" aria-hidden />
              </span>
              <div className="min-w-0 space-y-0.5">
                <p className="text-[11px] font-semibold uppercase leading-none tracking-wider text-muted-foreground">Schedule</p>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
                  <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">Calendar</h1>
                  <p className="text-sm text-muted-foreground">Week of {format(weekStart, "MMM d, yyyy")}</p>
                </div>
              </div>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              <Button onClick={() => openAddBooking()} className="gap-2">
                <Plus className="h-4 w-4" />
                Create appointment
              </Button>
              {!gcalConnected && (
                <Button variant="outline" size="sm" onClick={handleConnectGoogle} className="gap-2">
                  <ExternalLink className="h-4 w-4" />
                  Connect Google Calendar
                </Button>
              )}
              <div
                className="inline-flex items-center overflow-hidden rounded-md border border-border/80 bg-muted/35 dark:bg-muted/25"
                role="group"
                aria-label="Week navigation"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 rounded-none border-r border-border/60 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  onClick={() => setCurrentWeek((w) => subWeeks(w, 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 min-w-[4rem] rounded-none border-r border-border/60 px-2.5 text-xs font-medium text-foreground hover:bg-muted/80"
                  onClick={() => setCurrentWeek(new Date())}
                >
                  Today
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 rounded-none text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  onClick={() => setCurrentWeek((w) => addWeeks(w, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </header>

        {locations.length > 0 && (
          <div className="pb-1">
            <Tabs className="w-full max-w-full sm:w-fit" value={effectiveLocationId || ""} onValueChange={setSelectedLocationId}>
              <TabsList className="flex h-auto min-h-0 flex-wrap gap-1 border-0 bg-transparent p-0 shadow-none">
                {locations.map((loc) => (
                  <TabsTrigger
                    key={loc.id}
                    value={loc.id}
                    className="gap-1.5 rounded-md px-3 text-sm data-[state=active]:bg-primary/10 data-[state=active]:font-medium data-[state=active]:text-primary data-[state=active]:shadow-none"
                  >
                    <MapPin className="h-3.5 w-3.5 opacity-70" />
                    {loc.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        )}

        {locations.length === 0 && (
          <p className="text-sm text-muted-foreground">Add locations in Locations to see the calendar by location.</p>
        )}

        <div className="pt-0.5 sm:pt-1">
          {locations.length > 0 && (
            <>
              {isLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
                  <CalendarWeekGrid
                    key={effectiveLocationId}
                    weekDays={weekDays}
                    orgBookings={orgBookings}
                    gcalEvents={gcalEvents}
                    gcalConnected={!!gcalConnected}
                    locationId={effectiveLocationId || ""}
                    firstLocationId={firstLocationId}
                    organizationId={organization?.id ?? ""}
                    onAddBooking={(day, hour) => openAddBooking(day, hour)}
                    onAddBookingRange={openAddBookingRange}
                    onSelectBooking={setSelectedBooking}
                    onSelectOrphanGcal={setSelectedOrphanGcalEvent}
                  />
                </div>
              )}
            </>
          )}

          {locations.length === 0 && (
            <>
              {isLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
                  <CalendarWeekGrid
                    weekDays={weekDays}
                    orgBookings={orgBookings}
                    gcalEvents={gcalEvents}
                    gcalConnected={!!gcalConnected}
                    locationId=""
                    firstLocationId={firstLocationId}
                    organizationId={organization?.id ?? ""}
                    onAddBooking={(day, hour) => openAddBooking(day, hour)}
                    onAddBookingRange={openAddBookingRange}
                    onSelectBooking={setSelectedBooking}
                    onSelectOrphanGcal={setSelectedOrphanGcalEvent}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <OrphanGcalEventDialog
        event={selectedOrphanGcalEvent}
        open={!!selectedOrphanGcalEvent}
        onOpenChange={(open) => !open && setSelectedOrphanGcalEvent(null)}
        userId={user?.id ?? ""}
        organizationId={organization?.id ?? ""}
        orgTimeZone={orgTimeZone}
        defaultLocationId={effectiveLocationId || ""}
        onRemoveSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["gcal-events"] });
          refetchGcal();
          setSelectedOrphanGcalEvent(null);
        }}
        onLinked={(booking) => {
          queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
          queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
          queryClient.invalidateQueries({ queryKey: ["gcal-events"] });
          refetchGcal();
          setSelectedOrphanGcalEvent(null);
          setSelectedBooking(booking);
        }}
      />

      <ManageBookingDialog
        booking={selectedBooking}
        open={!!selectedBooking}
        onOpenChange={(open) => !open && setSelectedBooking(null)}
        organizationId={organization?.id ?? ""}
        orgTimeZone={orgTimeZone}
        userId={user?.id ?? ""}
        gcalConnected={!!gcalConnected}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
          queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
          if (gcalConnected) refetchGcal();
          setSelectedBooking(null);
        }}
      />

      <AddBookingDialog
        open={addBookingOpen}
        onOpenChange={(open) => {
          if (!open) closeAddBooking();
        }}
        organizationId={organization?.id ?? ""}
        orgTimeZone={orgTimeZone}
        initialStart={slotStart}
        initialEnd={slotEnd}
        defaultLocationId={selectedLocationId}
        gcalConnected={!!gcalConnected}
        onSuccess={(bookingId) => {
          queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
          if (bookingId && gcalConnected) {
            supabase.functions.invoke("sync-booking-to-gcal", { body: { booking_id: bookingId } }).then(() => {
              refetchGcal();
            });
          }
          closeAddBooking();
        }}
      />
    </>
  );
}

type AddBookingDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  orgTimeZone: string;
  initialStart: Date | null;
  /** When set with `initialStart`, booking end time follows this range (editable). */
  initialEnd?: Date | null;
  defaultLocationId?: string;
  gcalConnected?: boolean;
  onSuccess: (bookingId?: string) => void;
};

function AddBookingDialog({
  open,
  onOpenChange,
  organizationId,
  orgTimeZone,
  initialStart,
  initialEnd = null,
  defaultLocationId,
  gcalConnected,
  onSuccess,
}: AddBookingDialogProps) {
  const queryClient = useQueryClient();
  const [locationId, setLocationId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const STAFF_ANY = "__any__";
  const [customerFirstName, setCustomerFirstName] = useState("");
  const [customerLastName, setCustomerLastName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [startDate, setStartDate] = useState<Date>(() =>
    initialStart ? utcToOrgLocalCalendarDate(initialStart, orgTimeZone) : new Date(),
  );
  const [startTime, setStartTime] = useState(() =>
    initialStart ? formatInOrgTz(initialStart, orgTimeZone, "HH:mm") : format(new Date(Date.now() + 3600000), "HH:mm"),
  );
  const [endTime, setEndTime] = useState(() =>
    initialEnd ? formatInOrgTz(initialEnd, orgTimeZone, "HH:mm") : "10:00",
  );
  const [useCustomLength, setUseCustomLength] = useState(!!initialEnd);
  const [notes, setNotes] = useState("");
  const [customerSuggestionsOpen, setCustomerSuggestionsOpen] = useState(false);
  const customerName = [customerFirstName.trim(), customerLastName.trim()].filter(Boolean).join(" ").trim();

  const { data: existingCustomers = [] } = useQuery({
    queryKey: ["customers", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("confirmed_booking_customers")
        .select("customer_name, customer_email, customer_phone")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return (data || []).map((row) => ({
        customer_name: row.customer_name || "",
        customer_email: row.customer_email || "",
        customer_phone: row.customer_phone ?? null,
      })).filter((c) => c.customer_name || c.customer_email);
    },
    enabled: !!organizationId && open,
  });

  useEffect(() => {
    if (!open) return;
    if (initialStart) {
      setStartDate(utcToOrgLocalCalendarDate(initialStart, orgTimeZone));
      setStartTime(formatInOrgTz(initialStart, orgTimeZone, "HH:mm"));
    } else {
      const now = new Date();
      const next = new Date(now.getTime() + 3600000);
      setStartDate(now);
      setStartTime(format(next, "HH:mm"));
    }
    if (initialEnd) {
      setEndTime(formatInOrgTz(initialEnd, orgTimeZone, "HH:mm"));
      setUseCustomLength(true);
    } else {
      setUseCustomLength(false);
    }
  }, [open, initialStart, initialEnd, orgTimeZone]);

  useEffect(() => {
    if (open && defaultLocationId) setLocationId(defaultLocationId);
  }, [open, defaultLocationId]);

  useEffect(() => {
    if (!open) {
      setCustomerFirstName("");
      setCustomerLastName("");
      setCustomerEmail("");
      setCustomerPhone("");
      setNotes("");
      setCustomerSuggestionsOpen(false);
      setServiceId("");
      setStaffId(STAFF_ANY);
      setLocationId("");
      const now = new Date();
      const next = new Date(now.getTime() + 3600000);
      setStartDate(now);
      setStartTime(format(next, "HH:mm"));
      setEndTime("10:00");
      setUseCustomLength(false);
    }
  }, [open]);

  // When date is "today" in the salon zone, keep time from being in the past (enforce min time)
  useEffect(() => {
    if (!open || !startDate) return;
    if (orgDayKey(startDate, orgTimeZone) !== orgDayKey(new Date(), orgTimeZone)) return;
    const min = orgNowTimeHhmm(orgTimeZone);
    const chosenUtc = orgPickerDateAndTimeToUtc(startDate, startTime, orgTimeZone);
    if (!isBefore(chosenUtc, new Date())) return;
    if (startTime !== min) setStartTime(min);
  }, [open, startDate, startTime, orgTimeZone]);

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && open,
  });

  const { data: services = [] } = useQuery({
    queryKey: ["services", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && open,
  });

  const { data: staffForLocation = [] } = useQuery({
    queryKey: ["staff-for-location", locationId],
    queryFn: async () => {
      const { data: sl, error } = await supabase
        .from("staff_locations")
        .select("staff_id")
        .eq("location_id", locationId);
      if (error) throw error;
      const ids = (sl || []).map((r) => r.staff_id);
      if (ids.length === 0) return [];
      const { data: staff, error: staffErr } = await supabase
        .from("staff")
        .select("id, name")
        .in("id", ids)
        .eq("is_active", true);
      if (staffErr) throw staffErr;
      return staff || [];
    },
    enabled: !!locationId && open,
  });

  const selectedService = useMemo(() => services.find((s) => s.id === serviceId), [services, serviceId]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const start = orgPickerDateAndTimeToUtc(startDate, startTime, orgTimeZone);
      let end: Date;
      if (useCustomLength) {
        end = orgPickerDateAndTimeToUtc(startDate, endTime, orgTimeZone);
      } else {
        const duration = selectedService?.duration_minutes ?? 30;
        end = new Date(start.getTime() + duration * 60000);
      }

      const { data, error } = await supabase
        .from("bookings")
        .insert({
          organization_id: organizationId,
          location_id: locationId,
          service_id: serviceId,
          staff_id: (staffId && staffId !== "__any__") ? staffId : null,
          customer_name: customerName.trim(),
          customer_email: customerEmail.trim().toLowerCase(),
          customer_phone: customerPhone.trim() || null,
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          status: "confirmed",
          notes: notes.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      const email = customerEmail.trim().toLowerCase();
      await supabase.from("confirmed_booking_customers").upsert(
        {
          organization_id: organizationId,
          customer_email: email,
          customer_name: customerName.trim() || null,
          customer_phone: customerPhone.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,customer_email" }
      );
      return data?.id as string | undefined;
    },
    onSuccess: (bookingId) => {
      queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["gcal-events"] });
      queryClient.invalidateQueries({ queryKey: ["customers", organizationId] });
      toast({ title: "Booking created" });
      onSuccess(bookingId);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message ?? "Failed to create booking", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!customerName) {
      toast({ title: "Enter customer first and/or last name", variant: "destructive" });
      return;
    }
    if (!customerEmail.trim()) {
      toast({ title: "Enter customer email", variant: "destructive" });
      return;
    }
    if (!locationId || !serviceId) {
      toast({ title: "Select location and service", variant: "destructive" });
      return;
    }
    const start = orgPickerDateAndTimeToUtc(startDate, startTime, orgTimeZone);
    if (isBefore(start, new Date())) {
      toast({ title: "Start time must be in the future", variant: "destructive" });
      return;
    }
    if (useCustomLength) {
      const end = orgPickerDateAndTimeToUtc(startDate, endTime, orgTimeZone);
      if (end.getTime() <= start.getTime()) {
        toast({ title: "End time must be after start time", variant: "destructive" });
        return;
      }
      if (differenceInMinutes(end, start) < 15) {
        toast({ title: "Appointment must be at least 15 minutes long", variant: "destructive" });
        return;
      }
    }
    createMutation.mutate();
  };

  const isSelectedToday = startDate && orgDayKey(startDate, orgTimeZone) === orgDayKey(new Date(), orgTimeZone);
  const minTime = isSelectedToday ? orgNowTimeHhmm(orgTimeZone) : undefined;
  const minDateYmd = orgDayKey(new Date(), orgTimeZone);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create appointment</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Location</Label>
            <Select value={locationId} onValueChange={(v) => { setLocationId(v); setStaffId(""); }}>
              <SelectTrigger>
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Service</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger>
                <SelectValue placeholder="Select service" />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.duration_minutes} min)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {locationId && (
            <div className="grid gap-2">
              <Label>Staff (optional)</Label>
              <Select value={staffId || STAFF_ANY} onValueChange={setStaffId}>
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={STAFF_ANY}>Any</SelectItem>
                  {staffForLocation.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label>First name</Label>
              <Input
                value={customerFirstName}
                onChange={(e) => setCustomerFirstName(e.target.value)}
                onFocus={() => setCustomerSuggestionsOpen(true)}
                onBlur={() => setTimeout(() => setCustomerSuggestionsOpen(false), 200)}
                placeholder="First name"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label>Last name</Label>
              <Input
                value={customerLastName}
                onChange={(e) => setCustomerLastName(e.target.value)}
                onFocus={() => setCustomerSuggestionsOpen(true)}
                onBlur={() => setTimeout(() => setCustomerSuggestionsOpen(false), 200)}
                placeholder="Last name"
                autoComplete="off"
              />
            </div>
            {customerSuggestionsOpen && existingCustomers.length > 0 && (
              <div className="col-span-2 relative">
                <div className="absolute left-0 right-0 top-0 z-50 mt-1 max-h-[220px] overflow-auto rounded-md border bg-popover py-1 shadow-md">
                  {existingCustomers
                    .filter(
                      (c) =>
                        !customerName ||
                        (c.customer_name || "").toLowerCase().includes(customerName.toLowerCase()) ||
                        (c.customer_email || "").toLowerCase().includes(customerName.toLowerCase()) ||
                        (c.customer_email || "").toLowerCase().includes(customerFirstName.toLowerCase()) ||
                        (c.customer_email || "").toLowerCase().includes(customerLastName.toLowerCase())
                    )
                    .slice(0, 8)
                    .map((c) => {
                      const parts = (c.customer_name || "").trim().split(/\s+/);
                      const first = parts[0] ?? "";
                      const last = parts.slice(1).join(" ") ?? "";
                      return (
                        <button
                          key={c.customer_email}
                          type="button"
                          className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setCustomerFirstName(first);
                            setCustomerLastName(last);
                            setCustomerEmail(c.customer_email);
                            setCustomerPhone(c.customer_phone || "");
                            setCustomerSuggestionsOpen(false);
                          }}
                        >
                          <span className="font-medium">{c.customer_name || c.customer_email}</span>
                          <span className="text-xs text-muted-foreground">{c.customer_email}</span>
                          {c.customer_phone && (
                            <span className="text-xs text-muted-foreground">{c.customer_phone}</span>
                          )}
                        </button>
                      );
                    })}
                  {existingCustomers.filter(
                    (c) =>
                      !customerName ||
                      (c.customer_name || "").toLowerCase().includes(customerName.toLowerCase()) ||
                      (c.customer_email || "").toLowerCase().includes(customerName.toLowerCase()) ||
                      (c.customer_email || "").toLowerCase().includes(customerFirstName.toLowerCase()) ||
                      (c.customer_email || "").toLowerCase().includes(customerLastName.toLowerCase())
                  ).length === 0 && (
                    <p className="px-3 py-2 text-sm text-muted-foreground">No matching customer</p>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="grid gap-2">
            <Label>Email</Label>
            <Input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="email@example.com"
            />
          </div>
          <div className="grid gap-2">
            <Label>Phone (optional)</Label>
            <PhoneInput
              value={customerPhone}
              onChange={setCustomerPhone}
              placeholder="Contact number"
            />
          </div>
          {initialStart != null ? (
            <div className="grid gap-2">
              <Label>Date</Label>
              <p className="text-sm text-muted-foreground py-2 px-3 rounded-md border bg-muted/30">
                {format(startDate, "EEEE, MMM d, yyyy")}
              </p>
            </div>
          ) : (
            <div className="grid gap-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={format(startDate, "yyyy-MM-dd")}
                onChange={(e) => setStartDate(e.target.value ? new Date(e.target.value) : startDate)}
                min={minDateYmd}
              />
            </div>
          )}
          <div className="grid gap-2">
            <Label>Time</Label>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} min={minTime} />
          </div>
          {useCustomLength && (
            <div className="grid gap-2">
              <Label>End time</Label>
              <p className="text-xs text-muted-foreground -mt-1">
                Length is taken from your selection (not the service duration). You can adjust before saving.
              </p>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          )}
          <div className="grid gap-2">
            <Label>Notes (optional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Create booking
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function prefillNamePartsFromGcalSummary(summary: string): { first: string; last: string } {
  const emSplit = summary.split(/\s*[—–]\s*/);
  let namePart = emSplit.length >= 2 ? emSplit.slice(0, -1).join(" ").trim() : summary.trim();
  if (emSplit.length < 2) {
    const hySplit = namePart.split(/\s+\-\s+/);
    if (hySplit.length >= 2) {
      namePart = hySplit.slice(0, -1).join(" - ").trim();
    }
  }
  const parts = namePart.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

type OrphanGcalEventDialogProps = {
  event: { id: string; summary: string; start: string; end: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  organizationId: string;
  orgTimeZone: string;
  defaultLocationId: string;
  onRemoveSuccess: () => void;
  onLinked: (booking: any) => void;
};

const ORPHAN_STAFF_ANY = "__any__";

function OrphanGcalEventDialog({
  event,
  open,
  onOpenChange,
  userId,
  organizationId,
  orgTimeZone,
  defaultLocationId,
  onRemoveSuccess,
  onLinked,
}: OrphanGcalEventDialogProps) {
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState<string>(ORPHAN_STAFF_ANY);
  const [customerFirstName, setCustomerFirstName] = useState("");
  const [customerLastName, setCustomerLastName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [startDate, setStartDate] = useState<Date>(() => new Date());
  const [startTime, setStartTime] = useState("09:00");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open || !event) return;
    const { first, last } = prefillNamePartsFromGcalSummary(event.summary);
    setCustomerFirstName(first);
    setCustomerLastName(last);
    setCustomerEmail("");
    setCustomerPhone("");
    setNotes("");
    const s = new Date(event.start);
    setStartDate(utcToOrgLocalCalendarDate(s, orgTimeZone));
    setStartTime(formatInOrgTz(s, orgTimeZone, "HH:mm"));
    setServiceId("");
    setStaffId(ORPHAN_STAFF_ANY);
    setLocationId(defaultLocationId || "");
  }, [open, event, defaultLocationId, orgTimeZone]);

  const { data: locations = [] } = useQuery({
    queryKey: ["orphan-gcal-locations", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId && open,
  });

  const { data: services = [] } = useQuery({
    queryKey: ["orphan-gcal-services", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("is_active", true);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId && open,
  });

  const { data: staffForLocation = [] } = useQuery({
    queryKey: ["orphan-gcal-staff", locationId],
    queryFn: async () => {
      const { data: sl, error } = await supabase.from("staff_locations").select("staff_id").eq("location_id", locationId);
      if (error) throw error;
      const ids = (sl || []).map((r) => r.staff_id);
      if (ids.length === 0) return [];
      const { data: staff, error: staffErr } = await supabase
        .from("staff")
        .select("id, name")
        .in("id", ids)
        .eq("is_active", true);
      if (staffErr) throw staffErr;
      return staff ?? [];
    },
    enabled: !!locationId && open,
  });

  const selectedService = useMemo(() => services.find((s) => s.id === serviceId), [services, serviceId]);

  const linkMutation = useMutation({
    mutationFn: async () => {
      if (!event || !organizationId) throw new Error("Missing event or organization");
      const start = orgPickerDateAndTimeToUtc(startDate, startTime, orgTimeZone);
      const durationMin = selectedService?.duration_minutes ?? 30;
      const end = new Date(start.getTime() + durationMin * 60000);
      const customerName = [customerFirstName.trim(), customerLastName.trim()].filter(Boolean).join(" ").trim();
      const row = {
        organization_id: organizationId,
        location_id: locationId,
        service_id: serviceId,
        staff_id: staffId && staffId !== ORPHAN_STAFF_ANY ? staffId : null,
        customer_name: customerName,
        customer_email: customerEmail.trim().toLowerCase(),
        customer_phone: customerPhone.trim() || null,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        status: "confirmed" as const,
        gcal_event_id: event.id,
        notes: notes.trim() || null,
        customer_slot_date: orgDayKey(start, orgTimeZone),
        customer_slot_time: formatInOrgTz(start, orgTimeZone, "HH:mm"),
      };
      const { data, error } = await supabase
        .from("bookings")
        .insert(row)
        .select("*, service_id, services(name, duration_minutes), staff(name), locations(name), gcal_event_id")
        .single();
      if (error) throw error;
      const { error: fnErr } = await supabase.functions.invoke("sync-booking-to-gcal", {
        body: { booking_id: data.id },
      });
      if (fnErr) {
        console.error("sync-booking-to-gcal after link:", fnErr);
        toast({
          title: "Booking saved",
          description: "Could not update Google Calendar from the server. You can try again from the booking details.",
          variant: "destructive",
        });
      }
      const email = customerEmail.trim().toLowerCase();
      if (email) {
        await supabase.from("confirmed_booking_customers").upsert(
          {
            organization_id: organizationId,
            customer_email: email,
            customer_name: customerName || null,
            customer_phone: customerPhone.trim() || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id,customer_email" },
        );
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["customers", organizationId] });
      toast({ title: "Linked to salon booking", description: "You can edit or reschedule like any other appointment." });
      onLinked(data);
    },
    onError: (err: any) => {
      toast({ title: "Could not create booking", description: err?.message ?? "Try again", variant: "destructive" });
    },
  });

  const handleRemove = async () => {
    if (!event || !userId) return;
    setRemoving(true);
    try {
      const { error } = await supabase.functions.invoke("delete-gcal-event", {
        body: { event_id: event.id, user_id: userId },
      });
      if (error) throw error;
      toast({ title: "Removed from Google Calendar" });
      onRemoveSuccess();
    } catch (err: any) {
      toast({ title: "Error", description: err?.message ?? "Could not remove event from Google Calendar", variant: "destructive" });
    } finally {
      setRemoving(false);
    }
  };

  const handleLink = () => {
    if (!event) return;
    const customerName = [customerFirstName.trim(), customerLastName.trim()].filter(Boolean).join(" ").trim();
    if (!customerName) {
      toast({ title: "Enter customer first and/or last name", variant: "destructive" });
      return;
    }
    if (!customerEmail.trim()) {
      toast({ title: "Enter customer email", variant: "destructive" });
      return;
    }
    if (!locationId || !serviceId) {
      toast({ title: "Select location and service", variant: "destructive" });
      return;
    }
    linkMutation.mutate();
  };

  const busy = removing || linkMutation.isPending;

  if (!event) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          {/* <DialogTitle>Event from Google Calendar</DialogTitle> */}
        </DialogHeader>
        {/* <p className="text-sm text-muted-foreground">
          This event is only in Google Calendar (for example, from a booking that was deleted while disconnected). Link it
          to a salon booking to manage it like your other appointments, or remove it from Google only.
        </p> */}
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <p className="font-medium break-words">{event.summary}</p>
          <p className="text-muted-foreground">
            {format(new Date(event.start), "MMM d, yyyy · h:mm a")}
            {event.end ? ` – ${format(new Date(event.end), "h:mm a")}` : ""}
          </p>
        </div>

        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-medium">Link to salon booking</p>
          <div className="grid gap-2">
            <Label>Location</Label>
            <Select
              value={locationId}
              onValueChange={(v) => {
                setLocationId(v);
                setStaffId(ORPHAN_STAFF_ANY);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Service</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger>
                <SelectValue placeholder="Select service" />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.duration_minutes} min)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {locationId && (
            <div className="grid gap-2">
              <Label>Staff (optional)</Label>
              <Select value={staffId || ORPHAN_STAFF_ANY} onValueChange={setStaffId}>
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ORPHAN_STAFF_ANY}>Any</SelectItem>
                  {staffForLocation.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label>First name</Label>
              <Input value={customerFirstName} onChange={(e) => setCustomerFirstName(e.target.value)} placeholder="First name" />
            </div>
            <div className="grid gap-2">
              <Label>Last name</Label>
              <Input value={customerLastName} onChange={(e) => setCustomerLastName(e.target.value)} placeholder="Last name" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Email</Label>
            <Input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="email@example.com"
            />
          </div>
          <div className="grid gap-2">
            <Label>Phone (optional)</Label>
            <PhoneInput value={customerPhone} onChange={setCustomerPhone} placeholder="Contact number" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={format(startDate, "yyyy-MM-dd")}
                onChange={(e) => setStartDate(e.target.value ? new Date(e.target.value) : startDate)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Start time</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes" />
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button onClick={handleLink} disabled={busy} className="w-full gap-2">
            {linkMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save as salon booking
          </Button>
          <div className="flex w-full flex-wrap gap-2 justify-between">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRemove} disabled={busy} className="gap-2">
              {removing && <Loader2 className="h-4 w-4 animate-spin" />}
              {removing ? "Removing…" : "Remove"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ManageBookingDialogProps = {
  booking: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  orgTimeZone: string;
  userId: string;
  gcalConnected: boolean;
  onSuccess: () => void;
};

function ManageBookingDialog({
  booking,
  open,
  onOpenChange,
  organizationId,
  orgTimeZone,
  userId,
  gcalConnected,
  onSuccess,
}: ManageBookingDialogProps) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState<Date | undefined>();
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  useEffect(() => {
    if (open && booking) {
      setRescheduleDate(utcToOrgLocalCalendarDate(booking.start_time, orgTimeZone));
      setRescheduleTime(formatInOrgTz(booking.start_time, orgTimeZone, "HH:mm"));
    }
  }, [open, booking, orgTimeZone]);

  const rescheduleMutation = useMutation({
    mutationFn: async () => {
      if (!booking || !rescheduleDate || !rescheduleTime) return;
      const duration = (booking.services as { duration_minutes?: number })?.duration_minutes ?? 30;
      const start = orgPickerDateAndTimeToUtc(rescheduleDate, rescheduleTime, orgTimeZone);
      const end = new Date(start.getTime() + duration * 60000);
      const { error } = await supabase
        .from("bookings")
        .update({ start_time: start.toISOString(), end_time: end.toISOString(), status: "confirmed" })
        .eq("id", booking.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
      if (gcalConnected) {
        supabase.functions.invoke("sync-booking-to-gcal", { body: { booking_id: booking?.id } }).then(() => {
          queryClient.invalidateQueries({ queryKey: ["gcal-events"] });
        });
      }
      toast({ title: "Booking rescheduled" });
      setRescheduleOpen(false);
      onSuccess();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message ?? "Failed to reschedule", variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ status }: { status: string }) => {
      if (!booking) return;
      const { error } = await supabase
        .from("bookings")
        .update({ status: status as any })
        .eq("id", booking.id);
      if (error) throw error;
      if (gcalConnected && status === "cancelled" && booking.gcal_event_id) {
        const orgId = booking.organization_id ?? null;
        const { error: delErr } = await supabase.functions.invoke("delete-gcal-event", {
          body: orgId
            ? { event_id: booking.gcal_event_id, organization_id: orgId, booking_id: booking.id }
            : { event_id: booking.gcal_event_id, user_id: userId, booking_id: booking.id },
        });
        if (delErr) {
          console.error("delete-gcal-event after cancel:", delErr);
        } else {
          const { error: clearErr } = await supabase
            .from("bookings")
            .update({ gcal_event_id: null })
            .eq("id", booking.id);
          if (clearErr) console.error("clear gcal_event_id after cancel:", clearErr);
        }
      } else if (
        gcalConnected &&
        (status === "confirmed" || status === "paid" || status === "pending")
      ) {
        const { error: fnErr } = await supabase.functions.invoke("sync-booking-to-gcal", {
          body: { booking_id: booking.id },
        });
        if (fnErr) console.error("sync-booking-to-gcal after status change:", fnErr);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["gcal-events"] });
      toast({ title: "Status updated" });
      onSuccess();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message ?? "Failed to update status", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!booking) return;
      const gcalEventId = booking.gcal_event_id ?? null;
      const organizationId = booking.organization_id ?? null;
      const bookingId = booking.id;
      const { error } = await supabase.from("bookings").delete().eq("id", booking.id);
      if (error) throw error;
      return { gcalEventId, organizationId, bookingId };
    },
    onSuccess: async (data) => {
      if (data?.gcalEventId && (userId || data.organizationId)) {
        try {
          await supabase.functions.invoke("delete-gcal-event", {
            body: data.organizationId
              ? { event_id: data.gcalEventId, organization_id: data.organizationId, booking_id: data.bookingId }
              : { event_id: data.gcalEventId, user_id: userId, booking_id: data.bookingId },
          });
        } catch (e) {
          console.error("Failed to delete from Google Calendar:", e);
        }
      }
      queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["gcal-events"] });
      toast({ title: "Booking deleted" });
      setDeleteConfirmOpen(false);
      onSuccess();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message ?? "Failed to delete", variant: "destructive" });
    },
  });

  const rescheduleMinDateYmd = orgDayKey(new Date(), orgTimeZone);
  const isSelectedToday =
    rescheduleDate && orgDayKey(rescheduleDate, orgTimeZone) === orgDayKey(new Date(), orgTimeZone);
  const minTimeToday = orgNowTimeHhmm(orgTimeZone);

  const handleReschedule = () => {
    if (!rescheduleDate || !rescheduleTime || !booking) return;
    const start = orgPickerDateAndTimeToUtc(rescheduleDate, rescheduleTime, orgTimeZone);
    if (isBefore(start, new Date())) {
      toast({ title: "Choose a date and time in the future", variant: "destructive" });
      return;
    }
    rescheduleMutation.mutate();
  };

  if (!booking) return null;

  const svc = booking.services as { name?: string; duration_minutes?: number } | null;
  const staff = booking.staff as { name?: string } | null;
  const loc = booking.locations as { name?: string } | null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manage booking</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 min-w-0 overflow-hidden">
            <div className="min-w-0 overflow-hidden">
              <p className="text-xs font-medium text-muted-foreground">Customer</p>
              <p className="font-medium truncate" title={booking.customer_name}>{booking.customer_name}</p>
              {booking.customer_email && (
                <p className="text-sm text-muted-foreground truncate" title={booking.customer_email}>{booking.customer_email}</p>
              )}
              {booking.customer_phone && (
                <p className="text-sm text-muted-foreground truncate" title={booking.customer_phone}>{booking.customer_phone}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="min-w-0 overflow-hidden">
                <p className="text-xs font-medium text-muted-foreground">Service</p>
                <p className="truncate" title={svc?.name ?? undefined}>{svc?.name ?? "—"}</p>
              </div>
              <div className="min-w-0 overflow-hidden">
                <p className="text-xs font-medium text-muted-foreground">Staff</p>
                <p className="truncate" title={staff?.name ?? undefined}>{staff?.name ?? "Unassigned"}</p>
              </div>
              <div className="min-w-0 overflow-hidden">
                <p className="text-xs font-medium text-muted-foreground">Location</p>
                <p className="truncate" title={loc?.name ?? undefined}>{loc?.name ?? "—"}</p>
              </div>
              <div className="min-w-0 overflow-hidden">
                <p className="text-xs font-medium text-muted-foreground">Date & time</p>
                <p
                  className="truncate"
                  title={`${formatInOrgTz(booking.start_time, orgTimeZone, "MMM d, yyyy")} · ${formatInOrgTz(booking.start_time, orgTimeZone, "h:mm a")} – ${formatInOrgTz(booking.end_time, orgTimeZone, "h:mm a")}`}
                >
                  {formatInOrgTz(booking.start_time, orgTimeZone, "MMM d, yyyy")} ·{" "}
                  {formatInOrgTz(booking.start_time, orgTimeZone, "h:mm a")} –{" "}
                  {formatInOrgTz(booking.end_time, orgTimeZone, "h:mm a")}
                </p>
              </div>
              <div className="min-w-0 overflow-hidden col-span-2">
                <p className="text-xs font-medium text-muted-foreground">Status</p>
                <div className="flex items-center gap-2 mt-1 min-w-0">
                  <Badge variant="outline" className={`capitalize ${BOOKING_STATUS_COLORS[booking.status] ?? ""}`}>
                    {booking.status.replace("_", " ")}
                  </Badge>
                  <Select
                    value={booking.status}
                    onValueChange={(val) => statusMutation.mutate({ status: val })}
                    disabled={statusMutation.isPending}
                  >
                    <SelectTrigger className="w-[140px] h-8">
                      <SelectValue placeholder="Change status" />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        ...["pending", "confirmed", "paid"].includes(booking.status)
                          ? [{ value: booking.status, label: booking.status === "pending" ? "Pending" : booking.status === "confirmed" ? "Confirmed" : "Paid" }]
                          : [],
                        ...(booking.status !== "confirmed" ? [{ value: "confirmed", label: "Confirmed" }] : []),
                        ...BOOKING_STATUS_OPTIONS,
                      ].map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            {booking.notes && (
              <div className="min-w-0 overflow-hidden">
                <p className="text-xs font-medium text-muted-foreground">Notes</p>
                <p className="text-sm break-words" title={booking.notes}>{booking.notes}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditOpen(true)}>
                <Pencil className="h-3.5 w-3.5" />
                Edit booking
              </Button>
              {booking.status !== "cancelled" && booking.status !== "completed" && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setRescheduleOpen(true)}>
                  <CalendarClock className="h-3.5 w-3.5" />
                  Reschedule
                </Button>
              )}
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteConfirmOpen(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete permanently
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule booking</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>New date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start mt-1">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {rescheduleDate ? format(rescheduleDate, "PPP") : "Pick date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={rescheduleDate}
                    onSelect={setRescheduleDate}
                    disabled={(date) => format(date, "yyyy-MM-dd") < rescheduleMinDateYmd}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>New time</Label>
              <Input
                type="time"
                value={rescheduleTime}
                onChange={(e) => setRescheduleTime(e.target.value)}
                min={isSelectedToday ? minTimeToday : undefined}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleOpen(false)}>Cancel</Button>
            <Button onClick={handleReschedule} disabled={!rescheduleDate || !rescheduleTime || rescheduleMutation.isPending}>
              {rescheduleMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={(open) => !deleteMutation.isPending && setDeleteConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this booking permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the booking from the calendar and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Keep</AlertDialogCancel>
            <Button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <EditBookingDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        organizationId={organizationId}
        orgTimeZone={orgTimeZone}
        booking={booking}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
          queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
          if (gcalConnected) {
            supabase.functions.invoke("sync-booking-to-gcal", { body: { booking_id: booking.id } }).then(() => {
              queryClient.invalidateQueries({ queryKey: ["gcal-events"] });
            });
          }
          setEditOpen(false);
          onSuccess();
        }}
      />
    </>
  );
}

type EditBookingDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  orgTimeZone: string;
  booking: any;
  onSuccess: () => void;
};

function EditBookingDialog({
  open,
  onOpenChange,
  organizationId,
  orgTimeZone,
  booking,
  onSuccess,
}: EditBookingDialogProps) {
  const queryClient = useQueryClient();
  const [locationId, setLocationId] = useState(booking?.location_id ?? "");
  const [serviceId, setServiceId] = useState(booking?.service_id ?? "");
  const STAFF_ANY = "__any__";
  const [staffId, setStaffId] = useState(booking?.staff_id ?? STAFF_ANY);
  const parseFullName = (full: string) => {
    const parts = (full || "").trim().split(/\s+/);
    return { first: parts[0] ?? "", last: parts.slice(1).join(" ") ?? "" };
  };
  const [customerFirstName, setCustomerFirstName] = useState(() => parseFullName(booking?.customer_name ?? "").first);
  const [customerLastName, setCustomerLastName] = useState(() => parseFullName(booking?.customer_name ?? "").last);
  const [customerEmail, setCustomerEmail] = useState(booking?.customer_email ?? "");
  const [customerPhone, setCustomerPhone] = useState(booking?.customer_phone ?? "");
  const [startDate, setStartDate] = useState<Date>(() =>
    booking ? utcToOrgLocalCalendarDate(booking.start_time, orgTimeZone) : new Date(),
  );
  const [startTime, setStartTime] = useState(() =>
    booking ? formatInOrgTz(booking.start_time, orgTimeZone, "HH:mm") : "09:00",
  );
  const [notes, setNotes] = useState(booking?.notes ?? "");
  const customerName = [customerFirstName.trim(), customerLastName.trim()].filter(Boolean).join(" ").trim();

  useEffect(() => {
    if (open && booking) {
      setLocationId(booking.location_id ?? "");
      setServiceId(booking.service_id ?? "");
      setStaffId(booking.staff_id ?? STAFF_ANY);
      const { first, last } = parseFullName(booking.customer_name ?? "");
      setCustomerFirstName(first);
      setCustomerLastName(last);
      setCustomerEmail(booking.customer_email ?? "");
      setCustomerPhone(booking.customer_phone ?? "");
      setStartDate(utcToOrgLocalCalendarDate(booking.start_time, orgTimeZone));
      setStartTime(formatInOrgTz(booking.start_time, orgTimeZone, "HH:mm"));
      setNotes(booking.notes ?? "");
    }
  }, [open, booking, orgTimeZone]);

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && open,
  });

  const { data: services = [] } = useQuery({
    queryKey: ["services", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && open,
  });

  const { data: staffForLocation = [] } = useQuery({
    queryKey: ["staff-for-location", locationId],
    queryFn: async () => {
      const { data: sl, error } = await supabase
        .from("staff_locations")
        .select("staff_id")
        .eq("location_id", locationId);
      if (error) throw error;
      const ids = (sl || []).map((r) => r.staff_id);
      if (ids.length === 0) return [];
      const { data: staff, error: staffErr } = await supabase
        .from("staff")
        .select("id, name")
        .in("id", ids)
        .eq("is_active", true);
      if (staffErr) throw staffErr;
      return staff || [];
    },
    enabled: !!locationId && open,
  });

  const selectedService = useMemo(() => services.find((s) => s.id === serviceId), [services, serviceId]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const start = orgPickerDateAndTimeToUtc(startDate, startTime, orgTimeZone);
      const duration = selectedService?.duration_minutes ?? 30;
      const end = new Date(start.getTime() + duration * 60000);
      const { error } = await supabase
        .from("bookings")
        .update({
          location_id: locationId,
          service_id: serviceId,
          staff_id: staffId && staffId !== STAFF_ANY ? staffId : null,
          customer_name: customerName.trim(),
          customer_email: customerEmail.trim().toLowerCase(),
          customer_phone: customerPhone.trim() || null,
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          notes: notes.trim() || null,
        })
        .eq("id", booking.id);
      if (error) throw error;
      const email = customerEmail.trim().toLowerCase();
      await supabase.from("confirmed_booking_customers").upsert(
        {
          organization_id: booking.organization_id,
          customer_email: email,
          customer_name: customerName.trim() || null,
          customer_phone: customerPhone.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,customer_email" }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["all-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["customers", booking.organization_id] });
      toast({ title: "Booking updated" });
      onSuccess();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message ?? "Failed to update", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!customerName) {
      toast({ title: "Enter customer first and/or last name", variant: "destructive" });
      return;
    }
    if (!customerEmail.trim()) {
      toast({ title: "Enter customer email", variant: "destructive" });
      return;
    }
    if (!locationId || !serviceId) {
      toast({ title: "Select location and service", variant: "destructive" });
      return;
    }
    const start = orgPickerDateAndTimeToUtc(startDate, startTime, orgTimeZone);
    if (isBefore(start, new Date())) {
      toast({ title: "Start time must be in the future", variant: "destructive" });
      return;
    }
    updateMutation.mutate();
  };

  const editMinDateYmd = orgDayKey(new Date(), orgTimeZone);
  const isSelectedToday = startDate && orgDayKey(startDate, orgTimeZone) === orgDayKey(new Date(), orgTimeZone);
  const minTime = isSelectedToday ? orgNowTimeHhmm(orgTimeZone) : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit booking</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Location</Label>
            <Select value={locationId} onValueChange={(v) => { setLocationId(v); setStaffId(STAFF_ANY); }}>
              <SelectTrigger>
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Service</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger>
                <SelectValue placeholder="Select service" />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name} ({s.duration_minutes} min)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {locationId && (
            <div className="grid gap-2">
              <Label>Staff (optional)</Label>
              <Select value={staffId || STAFF_ANY} onValueChange={setStaffId}>
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={STAFF_ANY}>Any</SelectItem>
                  {staffForLocation.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label>First name</Label>
              <Input value={customerFirstName} onChange={(e) => setCustomerFirstName(e.target.value)} placeholder="First name" />
            </div>
            <div className="grid gap-2">
              <Label>Last name</Label>
              <Input value={customerLastName} onChange={(e) => setCustomerLastName(e.target.value)} placeholder="Last name" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Email</Label>
            <Input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="email@example.com" />
          </div>
          <div className="grid gap-2">
            <Label>Phone (optional)</Label>
            <PhoneInput value={customerPhone} onChange={setCustomerPhone} placeholder="Contact number" />
          </div>
          <div className="grid gap-2">
            <Label>Date</Label>
            <Input
              type="date"
              value={format(startDate, "yyyy-MM-dd")}
              onChange={(e) => setStartDate(e.target.value ? new Date(e.target.value) : startDate)}
              min={editMinDateYmd}
            />
          </div>
          <div className="grid gap-2">
            <Label>Time</Label>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} min={minTime} />
          </div>
          <div className="grid gap-2">
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={updateMutation.isPending}>
            {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
