import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Users, Trash2, Loader2, ChevronDown, KeyRound, MapPin } from "lucide-react";
import { StaffAvailability } from "@/components/StaffAvailability";
import { StaffLocationAssignment } from "@/components/StaffLocationAssignment";

export default function Staff() {
  const { organization } = useOrganization();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [expandedStaff, setExpandedStaff] = useState<string | null>(null);
  const [createAccount, setCreateAccount] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState("");

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

  const { data: staff = [], isLoading } = useQuery({
    queryKey: ["staff", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!organization,
  });

  const addStaff = useMutation({
    mutationFn: async ({ name, email, phone, password, locationId }: { name: string; email: string; phone: string; password?: string; locationId?: string }) => {
      const { data: newStaff, error } = await supabase
        .from("staff")
        .insert({ name, email, phone, organization_id: organization!.id })
        .select()
        .single();
      if (error) throw error;

      // Assign to location if selected
      if (locationId) {
        const { error: locError } = await supabase.from("staff_locations").insert({
          staff_id: newStaff.id,
          location_id: locationId,
        });
        if (locError) throw locError;
      }

      // If password provided, create auth account
      if (password && email) {
        const { data: result, error: fnError } = await supabase.functions.invoke("create-staff-account", {
          body: {
            email,
            password,
            staff_id: newStaff.id,
            organization_id: organization!.id,
          },
        });
        if (fnError) throw fnError;
        if (result?.error) throw new Error(result.error);
      }

      return newStaff;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["staff-locations"] });
      setOpen(false);
      setCreateAccount(false);
      setSelectedLocationId("");
      toast({ title: "Staff member added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteStaff = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staff").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff"] }),
  });

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = form.get("password") as string;
    addStaff.mutate({
      name: form.get("name") as string,
      email: form.get("email") as string,
      phone: form.get("phone") as string,
      ...(createAccount && password ? { password } : {}),
      ...(selectedLocationId ? { locationId: selectedLocationId } : {}),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Staff</h1>
          <p className="text-muted-foreground">Manage your team, availability & locations</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setCreateAccount(false); setSelectedLocationId(""); } }}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" />Add Staff</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Staff Member</DialogTitle></DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input name="name" required placeholder="Jane Doe" maxLength={100} minLength={2} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input name="email" type="email" placeholder="jane@example.com" maxLength={255} required={createAccount} />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input name="phone" placeholder="+1 234 567 890" maxLength={20} pattern="[\+\d\s\-\(\)]*" title="Enter a valid phone number" />
              </div>

              {/* Branch / Location */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Branch
                </Label>
                {locations.length > 0 ? (
                  <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Select a branch..." />
                    </SelectTrigger>
                    <SelectContent className="bg-popover z-50">
                      {locations.map(l => (
                        <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground">No branches created yet. Add one in Locations first.</p>
                )}
              </div>

              {/* Create account toggle */}
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <KeyRound className="h-4 w-4" />
                    Create login account
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Staff can sign in to view their bookings
                  </p>
                </div>
                <Switch checked={createAccount} onCheckedChange={setCreateAccount} />
              </div>

              {createAccount && (
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input name="password" type="password" required placeholder="Minimum 6 characters" minLength={6} maxLength={72} />
                </div>
              )}

              <Button type="submit" className="w-full" disabled={addStaff.isPending}>
                {addStaff.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Staff
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : staff.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No staff yet. Add your first team member.</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {staff.map((s) => (
            <Collapsible
              key={s.id}
              open={expandedStaff === s.id}
              onOpenChange={(open) => setExpandedStaff(open ? s.id : null)}
            >
              <Card>
                <CardHeader className="flex flex-row items-start justify-between pb-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                      <Users className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">{s.name}</CardTitle>
                        {s.user_id && (
                          <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
                            <KeyRound className="h-3 w-3 mr-1" />
                            Account
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{s.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <ChevronDown className={`h-4 w-4 transition-transform ${expandedStaff === s.id ? "rotate-180" : ""}`} />
                      </Button>
                    </CollapsibleTrigger>
                    <Button variant="ghost" size="icon" onClick={() => deleteStaff.mutate(s.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <StaffLocationAssignment staffId={s.id} />
                </CardContent>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <StaffAvailability staffId={s.id} staffName={s.name} />
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          ))}
        </div>
      )}
    </div>
  );
}
