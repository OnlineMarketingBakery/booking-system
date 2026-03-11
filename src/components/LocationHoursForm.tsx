import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus, Trash2, Copy } from "lucide-react";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 30) {
    TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
}

function formatTime(t: string) {
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${display}:${m} ${ampm}`;
}

export interface TimeSlot {
  id?: string;
  start_time: string;
  end_time: string;
}

export interface DaySchedule {
  enabled: boolean;
  slots: TimeSlot[];
}

export type WeekSchedule = Record<number, DaySchedule>;

export function getEmptySchedule(): WeekSchedule {
  const s: WeekSchedule = {};
  for (let i = 0; i < 7; i++) s[i] = { enabled: false, slots: [] };
  return s;
}

export function buildScheduleFromData(data: { day_of_week: number; start_time: string; end_time: string; id?: string }[]): WeekSchedule {
  const schedule: WeekSchedule = {};
  for (let i = 0; i < 7; i++) {
    schedule[i] = { enabled: false, slots: [] };
  }
  for (const row of data) {
    const day = row.day_of_week;
    schedule[day].enabled = true;
    schedule[day].slots.push({
      id: row.id,
      start_time: row.start_time.slice(0, 5),
      end_time: row.end_time.slice(0, 5),
    });
  }
  for (let i = 0; i < 7; i++) {
    schedule[i].slots.sort((a, b) => a.start_time.localeCompare(b.start_time));
  }
  return schedule;
}

function getSlotError(slot: TimeSlot): string | null {
  if (slot.start_time >= slot.end_time) return "End must be after start";
  return null;
}

export interface LocationHoursFormProps {
  schedule: WeekSchedule;
  onScheduleChange: (updater: (prev: WeekSchedule) => WeekSchedule) => void;
  onCopyToAll?: (dayShort: string) => void;
}

export function LocationHoursForm({ schedule, onScheduleChange, onCopyToAll }: LocationHoursFormProps) {
  const toggleDay = (day: number) => {
    onScheduleChange((prev) => {
      const next = { ...prev };
      if (next[day].enabled) {
        next[day] = { enabled: false, slots: [] };
      } else {
        next[day] = { enabled: true, slots: [{ start_time: "09:00", end_time: "17:00" }] };
      }
      return next;
    });
  };

  const updateSlotTime = (day: number, slotIdx: number, field: "start_time" | "end_time", value: string) => {
    onScheduleChange((prev) => {
      const next = { ...prev };
      const slots = [...next[day].slots];
      slots[slotIdx] = { ...slots[slotIdx], [field]: value };
      next[day] = { ...next[day], slots };
      return next;
    });
  };

  const addSlot = (day: number) => {
    onScheduleChange((prev) => {
      const next = { ...prev };
      const lastSlot = next[day].slots[next[day].slots.length - 1];
      const newStart = lastSlot ? lastSlot.end_time : "09:00";
      const [h] = newStart.split(":").map(Number);
      const newEnd = `${String(Math.min(h + 1, 23)).padStart(2, "0")}:00`;
      next[day] = { ...next[day], slots: [...next[day].slots, { start_time: newStart, end_time: newEnd }] };
      return next;
    });
  };

  const removeSlot = (day: number, slotIdx: number) => {
    onScheduleChange((prev) => {
      const next = { ...prev };
      const slots = next[day].slots.filter((_, i) => i !== slotIdx);
      next[day] = { ...next[day], slots, enabled: slots.length > 0 };
      return next;
    });
  };

  const copyToAll = (sourceDay: number) => {
    onScheduleChange((prev) => {
      const next = { ...prev };
      const source = prev[sourceDay];
      for (let i = 0; i < 7; i++) {
        if (i !== sourceDay) {
          next[i] = {
            enabled: source.enabled,
            slots: source.slots.map((s) => ({ start_time: s.start_time, end_time: s.end_time })),
          };
        }
      }
      return next;
    });
    onCopyToAll?.(DAY_SHORT[sourceDay]);
  };

  return (
    <div className="space-y-1 max-h-[320px] overflow-y-auto pr-1">
      {DAYS.map((dayName, dayIdx) => {
        const daySchedule = schedule[dayIdx];
        return (
          <div
            key={dayIdx}
            className={cn(
              "flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors",
              daySchedule.enabled ? "bg-muted/50" : "opacity-60"
            )}
          >
            <div className="flex items-center gap-3 min-w-[100px] pt-0.5 shrink-0">
              <Switch
                checked={daySchedule.enabled}
                onCheckedChange={() => toggleDay(dayIdx)}
                aria-label={`Toggle ${dayName}`}
              />
              <span className={cn("text-sm font-medium min-w-[36px]", !daySchedule.enabled && "text-muted-foreground")}>
                {DAY_SHORT[dayIdx]}
              </span>
            </div>
            {daySchedule.enabled ? (
              <div className="flex-1 space-y-2 min-w-0">
                {daySchedule.slots.map((slot, slotIdx) => {
                  const error = getSlotError(slot);
                  return (
                    <div key={slotIdx} className="flex items-center gap-2 flex-wrap">
                      <Select value={slot.start_time} onValueChange={(v) => updateSlotTime(dayIdx, slotIdx, "start_time", v)}>
                        <SelectTrigger className="w-[100px] h-8 text-xs">
                          <SelectValue>{formatTime(slot.start_time)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {TIME_OPTIONS.map((t) => (
                            <SelectItem key={t} value={t}>{formatTime(t)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-xs text-muted-foreground">to</span>
                      <Select value={slot.end_time} onValueChange={(v) => updateSlotTime(dayIdx, slotIdx, "end_time", v)}>
                        <SelectTrigger className={cn("w-[100px] h-8 text-xs", error && "border-destructive")}>
                          <SelectValue>{formatTime(slot.end_time)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {TIME_OPTIONS.map((t) => (
                            <SelectItem key={t} value={t}>{formatTime(t)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {daySchedule.slots.length > 1 && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeSlot(dayIdx, slotIdx)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {slotIdx === daySchedule.slots.length - 1 && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => addSlot(dayIdx)} title="Add break / split shift">
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {slotIdx === 0 && daySchedule.slots.length <= 1 && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => copyToAll(dayIdx)} title="Copy to all days">
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {error && <span className="text-xs text-destructive">{error}</span>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground pt-0.5">Closed</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const DAYS_LIST = DAYS;
