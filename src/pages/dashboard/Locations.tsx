import { useState } from "react";
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
import { Plus, MapPin, Trash2, Loader2 } from "lucide-react";

const TIER_LIMITS: Record<string, number> = {
  tier_1: 1,
  tier_2: 10,
  tier_3: 100,
};

export default function Locations() {
  const { organization } = useOrganization();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
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

  const addLocation = useMutation({
    mutationFn: async ({ name, address, phone }: { name: string; address: string; phone: string }) => {
      if (locations.length >= maxLocations) {
        throw new Error(`Your plan allows up to ${maxLocations} location${maxLocations > 1 ? "s" : ""}. Please upgrade your tier to add more.`);
      }
      const { error } = await supabase
        .from("locations")
        .insert({ name, address, phone, organization_id: organization!.id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      setOpen(false);
      toast({ title: "Location added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteLocation = useMutation({
    mutationFn: async (id: string) => {
      // Soft-delete: hide from lists and booking flow; existing bookings still show this location
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

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!validateSpamProtection(form)) {
      toast({ title: "Please wait a moment", description: "Then try adding the location again.", variant: "destructive" });
      return;
    }
    addLocation.mutate({
      name: form.get("name") as string,
      address: form.get("address") as string,
      phone: form.get("phone") as string,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Locations</h1>
          <p className="text-muted-foreground">Manage your salon locations ({locations.length}/{maxLocations})</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button disabled={locations.length >= maxLocations}><Plus className="mr-2 h-4 w-4" />Add Location</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Location</DialogTitle></DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              <SpamProtectionFields {...SpamProtectionFieldsProps} />
              <div className="space-y-2">
                <Label>Name</Label>
                <Input name="name" required placeholder="Main Branch" maxLength={100} minLength={2} />
              </div>
              <div className="space-y-2">
                <Label>Address</Label>
                <Input name="address" placeholder="123 Main St" maxLength={255} />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input name="phone" placeholder="+1 234 567 890" maxLength={20} pattern="[\+\d\s\-\(\)]*" title="Enter a valid phone number" />
              </div>
              <Button type="submit" className="w-full" disabled={addLocation.isPending}>
                {addLocation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Location
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

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
                <Button variant="ghost" size="icon" onClick={() => deleteLocation.mutate(loc.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {loc.address && <p>{loc.address}</p>}
                {loc.phone && <p>{loc.phone}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
