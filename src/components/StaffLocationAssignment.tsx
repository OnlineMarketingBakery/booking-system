import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { MapPin, Loader2 } from "lucide-react";

interface StaffLocationAssignmentProps {
  staffId: string;
}

export function StaffLocationAssignment({ staffId }: StaffLocationAssignmentProps) {
  const { organization } = useOrganization();
  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  const currentAssignment = staffLocations[0] ?? null;

  const assignOrChangeLocation = useMutation({
    mutationFn: async (locationId: string) => {
      const { error: delErr } = await supabase.from("staff_locations").delete().eq("staff_id", staffId);
      if (delErr) throw delErr;
      const { error } = await supabase.from("staff_locations").insert({
        staff_id: staffId,
        location_id: locationId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-locations", staffId] });
      toast({ title: "Location updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removeLocation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staff_locations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-locations", staffId] });
      toast({ title: "Location removed" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const isPending = assignOrChangeLocation.isPending || removeLocation.isPending;

  const NONE_VALUE = "__none__";

  const handleValueChange = (value: string) => {
    if (value === NONE_VALUE) {
      if (currentAssignment) removeLocation.mutate(currentAssignment.id);
    } else {
      assignOrChangeLocation.mutate(value);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <MapPin className="h-3.5 w-3.5" />
        <span>Location</span>
      </div>
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      ) : locations.length === 0 ? (
        <p className="text-xs text-muted-foreground">No locations created yet</p>
      ) : (
        <div className="flex items-center gap-1">
          <Select
            value={currentAssignment?.location_id ?? ""}
            onValueChange={handleValueChange}
            disabled={isPending}
          >
            <SelectTrigger className="h-7 w-40 text-xs">
              <SelectValue placeholder="Assign location..." />
            </SelectTrigger>
            <SelectContent>
              {currentAssignment && (
                <SelectItem value={NONE_VALUE}>— None —</SelectItem>
              )}
              {locations.map(l => (
                <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      )}
    </div>
  );
}
