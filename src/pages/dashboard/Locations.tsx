import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useSpamProtection } from "@/hooks/useSpamProtection";
import { SpamProtectionFields } from "@/components/SpamProtectionFields";
import { Plus, MapPin, Trash2, Loader2, Clock, Pencil } from "lucide-react";
import {
  LocationHoursForm,
  getEmptySchedule,
  buildScheduleFromData,
  type WeekSchedule,
} from "@/components/LocationHoursForm";
import { DAYS_LIST } from "@/components/LocationHoursForm";

const TIER_LIMITS: Record<string, number> = {
  tier_1: 1,
  tier_2: 10,
  tier_3: 100,
};

export default function Locations() {
  const { organization } = useOrganization();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<{ id: string; name: string; address?: string | null; phone?: string | null } | null>(null);
  const [formName, setFormName] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [schedule, setSchedule] = useState<WeekSchedule>(getEmptySchedule);
  const { validateSpamProtection, SpamProtectionFieldsProps } = useSpamProtection();

  const tier = (organization as any)?.tier as string | undefined;
  const maxLocations = TIER_LIMITS[tier || "tier_1"] ?? 1;

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ["locations", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("*")
        .eq("organization_id", organization!.id)
        .eq("is_active", true)
        .order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!organization,
  });

  const { data: editAvailability = [] } = useQuery({
    queryKey: ["location-availability", editingLocation?.id],
    queryFn: async () => {
      if (!editingLocation?.id) return [];
      const { data, error } = await supabase
        .from("location_availability")
        .select("*")
        .eq("location_id", editingLocation.id)
        .order("day_of_week")
        .order("start_time");
      if (error) throw error;
      return data;
    },
    enabled: !!editingLocation?.id && dialogOpen,
  });

  useEffect(() => {
    if (editingLocation && dialogOpen) {
      setFormName(editingLocation.name);
      setFormAddress(editingLocation.address ?? "");
      setFormPhone(editingLocation.phone ?? "");
    } else if (!editingLocation && dialogOpen) {
      setFormName("");
      setFormAddress("");
      setFormPhone("");
      setSchedule(getEmptySchedule());
    }
  }, [editingLocation, dialogOpen]);

  useEffect(() => {
    if (editingLocation && editAvailability.length >= 0 && dialogOpen) {
      setSchedule(buildScheduleFromData(editAvailability));
    }
  }, [editingLocation?.id, editAvailability, dialogOpen]);

  const openAdd = () => {
    setEditingLocation(null);
    setDialogOpen(true);
    setFormName("");
    setFormAddress("");
    setFormPhone("");
    setSchedule(getEmptySchedule());
  };

  const openEdit = (loc: { id: string; name: string; address?: string | null; phone?: string | null }) => {
    setEditingLocation(loc);
    setDialogOpen(true);
    setFormName(loc.name);
    setFormAddress(loc.address ?? "");
    setFormPhone(loc.phone ?? "");
  };

  const saveLocation = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error("No organization");
      if (locations.length >= maxLocations && !editingLocation) {
        throw new Error(`Your plan allows up to ${maxLocations} location${maxLocations > 1 ? "s" : ""}. Please upgrade your tier to add more.`);
      }
      for (let day = 0; day < 7; day++) {
        if (!schedule[day].enabled) continue;
        for (const slot of schedule[day].slots) {
          if (slot.start_time >= slot.end_time) {
            throw new Error(`${DAYS_LIST[day]}: Start time must be before end time`);
          }
        }
      }
      if (editingLocation) {
        const { error } = await supabase
          .from("locations")
          .update({ name: formName.trim(), address: formAddress.trim() || null, phone: formPhone.trim() || null })
          .eq("id", editingLocation.id)
          .eq("organization_id", organization.id);
        if (error) throw error;
        const { error: delErr } = await supabase
          .from("location_availability")
          .delete()
          .eq("location_id", editingLocation.id);
        if (delErr) throw delErr;
        const inserts: { location_id: string; day_of_week: number; start_time: string; end_time: string }[] = [];
        for (let day = 0; day < 7; day++) {
          if (!schedule[day].enabled) continue;
          for (const slot of schedule[day].slots) {
            inserts.push({
              location_id: editingLocation.id,
              day_of_week: day,
              start_time: slot.start_time,
              end_time: slot.end_time,
            });
          }
        }
        if (inserts.length > 0) {
          const { error: insErr } = await supabase.from("location_availability").insert(inserts);
          if (insErr) throw insErr;
        }
        return { id: editingLocation.id };
      } else {
        const { data: newLoc, error } = await supabase
          .from("locations")
          .insert({ name: formName.trim(), address: formAddress.trim() || null, phone: formPhone.trim() || null, organization_id: organization.id })
          .select("id")
          .single();
        if (error) throw error;
        const inserts: { location_id: string; day_of_week: number; start_time: string; end_time: string }[] = [];
        for (let day = 0; day < 7; day++) {
          if (!schedule[day].enabled) continue;
          for (const slot of schedule[day].slots) {
            inserts.push({
              location_id: newLoc.id,
              day_of_week: day,
              start_time: slot.start_time,
              end_time: slot.end_time,
            });
          }
        }
        if (inserts.length > 0) {
          const { error: insErr } = await supabase.from("location_availability").insert(inserts);
          if (insErr) throw insErr;
        }
        return { id: newLoc.id };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      queryClient.invalidateQueries({ queryKey: ["location-availability"] });
      setDialogOpen(false);
      setEditingLocation(null);
      toast({ title: editingLocation ? "Location updated" : "Location added" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteLocation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("locations").update({ is_active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      toast({ title: "Location removed", description: "It won't appear for new bookings; existing bookings still show it." });
    },
    onError: (err: unknown) =>
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Could not remove location.",
        variant: "destructive",
      }),
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!validateSpamProtection(form)) {
      toast({ title: "Please wait a moment", description: "Then try again.", variant: "destructive" });
      return;
    }
    saveLocation.mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Locations</h1>
          <p className="text-muted-foreground">Manage your salon locations ({locations.length}/{maxLocations})</p>
        </div>
        <Button disabled={locations.length >= maxLocations} onClick={openAdd}>
          <Plus className="mr-2 h-4 w-4" />
          Add Location
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingLocation(null); }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingLocation ? "Edit Location" : "Add Location"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <SpamProtectionFields {...SpamProtectionFieldsProps} />
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
                placeholder="Main Branch"
                maxLength={100}
                minLength={2}
                name="name"
              />
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input
                value={formAddress}
                onChange={(e) => setFormAddress(e.target.value)}
                placeholder="123 Main St"
                maxLength={255}
                name="address"
              />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={formPhone}
                onChange={(e) => setFormPhone(e.target.value)}
                placeholder="+1 234 567 890"
                maxLength={20}
                pattern="[\+\d\s\-\(\)]*"
                name="phone"
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Opening hours
              </Label>
              <LocationHoursForm
                schedule={schedule}
                onScheduleChange={setSchedule}
                onCopyToAll={(day) => toast({ title: `Copied ${day}'s schedule to all days` })}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={saveLocation.isPending}>
                {saveLocation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingLocation ? "Save changes" : "Add Location"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : locations.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No locations yet. Add your first location.</CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {locations.map((loc) => (
            <Card key={loc.id}>
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">{loc.name}</CardTitle>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(loc)} title="Edit location & hours">
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteLocation.mutate(loc.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {loc.address && <p>{loc.address}</p>}
                {loc.phone && <p>{loc.phone}</p>}
                {!loc.address && !loc.phone && <p className="opacity-70">No address or phone</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
