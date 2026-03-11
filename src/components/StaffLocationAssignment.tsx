import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { MapPin, X, Loader2 } from "lucide-react";
import { useState } from "react";

interface StaffLocationAssignmentProps {
  staffId: string;
}

export function StaffLocationAssignment({ staffId }: StaffLocationAssignmentProps) {
  const { organization } = useOrganization();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedLocation, setSelectedLocation] = useState("");

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("*")
        .eq("organization_id", organization!.id)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
    enabled: !!organization,
  });

  const { data: staffLocations = [], isLoading } = useQuery({
    queryKey: ["staff-locations", staffId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_locations")
        .select("*, locations(name)")
        .eq("staff_id", staffId);
      if (error) throw error;
      return data;
    },
  });

  const assignedLocationIds = staffLocations.map(sl => sl.location_id);
  const unassignedLocations = locations.filter(l => !assignedLocationIds.includes(l.id));

  const assignLocation = useMutation({
    mutationFn: async (locationId: string) => {
      const { error } = await supabase.from("staff_locations").insert({
        staff_id: staffId,
        location_id: locationId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-locations", staffId] });
      setSelectedLocation("");
      toast({ title: "Location assigned" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removeLocation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staff_locations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff-locations", staffId] }),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <MapPin className="h-3.5 w-3.5" />
        <span>Locations</span>
      </div>
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {staffLocations.map(sl => (
            <Badge key={sl.id} variant="outline" className="flex items-center gap-1">
              {(sl as any).locations?.name}
              <button onClick={() => removeLocation.mutate(sl.id)} className="text-destructive hover:text-destructive/80">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {unassignedLocations.length > 0 && (
            <div className="flex items-center gap-1">
              <Select
                value={selectedLocation}
                onValueChange={(value) => {
                  setSelectedLocation(value);
                  if (value) assignLocation.mutate(value);
                }}
                disabled={assignLocation.isPending}
              >
                <SelectTrigger className="h-7 w-32 text-xs">
                  <SelectValue placeholder="Add location..." />
                </SelectTrigger>
                <SelectContent>
                  {unassignedLocations.map(l => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {assignLocation.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          )}
          {staffLocations.length === 0 && unassignedLocations.length === 0 && locations.length === 0 && (
            <p className="text-xs text-muted-foreground">No locations created yet</p>
          )}
          {staffLocations.length === 0 && unassignedLocations.length === 0 && locations.length > 0 && (
            <p className="text-xs text-muted-foreground">All locations assigned</p>
          )}
        </div>
      )}
    </div>
  );
}
