import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Clock, Loader2, Save, Plus, Trash2, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Generate time options in 30-min increments
const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 30) {
    TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
}

function formatTime(t: string) {
  const [h, m] = t.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${display}:${m} ${ampm}`;
}

interface TimeSlot {
  id?: string;
  start_time: string;
  end_time: string;
}

interface DaySchedule {
  enabled: boolean;
  slots: TimeSlot[];
}

type WeekSchedule = Record<number, DaySchedule>;

interface StaffAvailabilityProps {
  staffId: string;
  staffName: string;
}

function buildScheduleFromData(data: any[]): WeekSchedule {
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
  // Sort slots within each day
  for (let i = 0; i < 7; i++) {
    schedule[i].slots.sort((a, b) => a.start_time.localeCompare(b.start_time));
  }
  return schedule;
}

export function StaffAvailability({ staffId, staffName }: StaffAvailabilityProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [schedule, setSchedule] = useState<WeekSchedule>(() => {
    const s: WeekSchedule = {};
    for (let i = 0; i < 7; i++) s[i] = { enabled: false, slots: [] };
    return s;
  });
  const [hasChanges, setHasChanges] = useState(false);

  const { data: availability = [], isLoading } = useQuery({
    queryKey: ["availability", staffId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("availability")
        .select("*")
        .eq("staff_id", staffId)
        .order("day_of_week")
        .order("start_time");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    setSchedule(buildScheduleFromData(availability));
    setHasChanges(false);
  }, [availability]);

  const updateSchedule = useCallback((updater: (prev: WeekSchedule) => WeekSchedule) => {
    setSchedule((prev) => {
      const next = updater(prev);
      setHasChanges(true);
      return next;
    });
  }, []);

  const toggleDay = (day: number) => {
    updateSchedule((prev) => {
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
    updateSchedule((prev) => {
      const next = { ...prev };
      const slots = [...next[day].slots];
      slots[slotIdx] = { ...slots[slotIdx], [field]: value };
      next[day] = { ...next[day], slots };
      return next;
    });
  };

  const addSlot = (day: number) => {
    updateSchedule((prev) => {
      const next = { ...prev };
      const lastSlot = next[day].slots[next[day].slots.length - 1];
      const newStart = lastSlot ? lastSlot.end_time : "09:00";
      // Add 1 hour for end time
      const [h] = newStart.split(":").map(Number);
      const newEnd = `${String(Math.min(h + 1, 23)).padStart(2, "0")}:00`;
      next[day] = { ...next[day], slots: [...next[day].slots, { start_time: newStart, end_time: newEnd }] };
      return next;
    });
  };

  const removeSlot = (day: number, slotIdx: number) => {
    updateSchedule((prev) => {
      const next = { ...prev };
      const slots = next[day].slots.filter((_, i) => i !== slotIdx);
      next[day] = { ...next[day], slots, enabled: slots.length > 0 };
      return next;
    });
  };

  const copyToAll = (sourceDay: number) => {
    updateSchedule((prev) => {
      const next = { ...prev };
      const source = next[sourceDay];
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
    toast({ title: `Copied ${DAY_SHORT[sourceDay]}'s schedule to all days` });
  };

  const saveSchedule = useMutation({
    mutationFn: async () => {
      // Delete all existing, then insert new
      const { error: delErr } = await supabase
        .from("availability")
        .delete()
        .eq("staff_id", staffId);
      if (delErr) throw delErr;

      const inserts: { staff_id: string; day_of_week: number; start_time: string; end_time: string }[] = [];
      for (let day = 0; day < 7; day++) {
        if (!schedule[day].enabled) continue;
        for (const slot of schedule[day].slots) {
          if (slot.start_time >= slot.end_time) {
            throw new Error(`${DAYS[day]}: Start time must be before end time`);
          }
          inserts.push({
            staff_id: staffId,
            day_of_week: day,
            start_time: slot.start_time,
            end_time: slot.end_time,
          });
        }
      }

      if (inserts.length > 0) {
        const { error: insErr } = await supabase.from("availability").insert(inserts);
        if (insErr) throw insErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["availability", staffId] });
      setHasChanges(false);
      toast({ title: "Working hours saved" });
    },
    onError: (err: any) => {
      toast({ title: "Error saving", description: err.message, variant: "destructive" });
    },
  });

  // Validation helpers
  const getSlotError = (slot: TimeSlot): string | null => {
    if (slot.start_time >= slot.end_time) return "End must be after start";
    return null;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-primary" />
            {staffName} — Working Hours
          </CardTitle>
          {hasChanges && (
            <Button
              size="sm"
              onClick={() => saveSchedule.mutate()}
              disabled={saveSchedule.isPending}
            >
              {saveSchedule.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
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
              {/* Day toggle */}
              <div className="flex items-center gap-3 min-w-[120px] pt-0.5">
                <Switch
                  checked={daySchedule.enabled}
                  onCheckedChange={() => toggleDay(dayIdx)}
                  aria-label={`Toggle ${dayName}`}
                />
                <span className={cn(
                  "text-sm font-medium min-w-[36px]",
                  !daySchedule.enabled && "text-muted-foreground"
                )}>
                  {DAY_SHORT[dayIdx]}
                </span>
              </div>

              {/* Time slots */}
              {daySchedule.enabled ? (
                <div className="flex-1 space-y-2">
                  {daySchedule.slots.map((slot, slotIdx) => {
                    const error = getSlotError(slot);
                    return (
                      <div key={slotIdx} className="flex items-center gap-2 flex-wrap">
                        <Select
                          value={slot.start_time}
                          onValueChange={(v) => updateSlotTime(dayIdx, slotIdx, "start_time", v)}
                        >
                          <SelectTrigger className="w-[110px] h-8 text-xs">
                            <SelectValue>{formatTime(slot.start_time)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {TIME_OPTIONS.map((t) => (
                              <SelectItem key={t} value={t}>{formatTime(t)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <span className="text-xs text-muted-foreground">to</span>

                        <Select
                          value={slot.end_time}
                          onValueChange={(v) => updateSlotTime(dayIdx, slotIdx, "end_time", v)}
                        >
                          <SelectTrigger className={cn(
                            "w-[110px] h-8 text-xs",
                            error && "border-destructive"
                          )}>
                            <SelectValue>{formatTime(slot.end_time)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {TIME_OPTIONS.map((t) => (
                              <SelectItem key={t} value={t}>{formatTime(t)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {daySchedule.slots.length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => removeSlot(dayIdx, slotIdx)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {slotIdx === daySchedule.slots.length - 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-primary"
                            onClick={() => addSlot(dayIdx)}
                            title="Add break / split shift"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {slotIdx === 0 && daySchedule.slots.length <= 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-primary"
                            onClick={() => copyToAll(dayIdx)}
                            title="Copy to all days"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {error && (
                          <span className="text-xs text-destructive">{error}</span>
                        )}
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
      </CardContent>
    </Card>
  );
}
