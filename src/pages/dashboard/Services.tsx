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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Scissors, Trash2, Loader2, Clock, DollarSign } from "lucide-react";

const CURRENCIES = [
  { value: "usd", label: "USD ($)", symbol: "$" },
  { value: "eur", label: "EUR (€)", symbol: "€" },
  { value: "gbp", label: "GBP (£)", symbol: "£" },
  { value: "cad", label: "CAD (C$)", symbol: "C$" },
  { value: "aud", label: "AUD (A$)", symbol: "A$" },
  { value: "jpy", label: "JPY (¥)", symbol: "¥" },
  { value: "inr", label: "INR (₹)", symbol: "₹" },
  { value: "brl", label: "BRL (R$)", symbol: "R$" },
];

const getCurrencySymbol = (code: string) => CURRENCIES.find(c => c.value === code)?.symbol || "$";

export default function Services() {
  const { organization } = useOrganization();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { validateSpamProtection, SpamProtectionFieldsProps } = useSpamProtection();

  const { data: services = [], isLoading } = useQuery({
    queryKey: ["services", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("organization_id", organization!.id)
        .eq("is_active", true)
        .order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!organization,
  });

  const addService = useMutation({
    mutationFn: async (values: { name: string; duration_minutes: number; price: number; description: string; currency: string }) => {
      const { error } = await supabase
        .from("services")
        .insert({ ...values, organization_id: organization!.id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services"] });
      setOpen(false);
      toast({ title: "Service added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteService = useMutation({
    mutationFn: async (id: string) => {
      // Soft-delete: hide from lists and booking flow; existing bookings still show this service
      const { error } = await supabase.from("services").update({ is_active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services"] });
      toast({ title: "Service removed", description: "It won't appear for new bookings; existing bookings still show it." });
    },
    onError: (err: unknown) =>
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Could not remove service.",
        variant: "destructive",
      }),
  });

  const [currency, setCurrency] = useState("usd");

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!validateSpamProtection(form)) {
      toast({ title: "Please wait a moment", description: "Then try adding the service again.", variant: "destructive" });
      return;
    }
    addService.mutate({
      name: form.get("name") as string,
      duration_minutes: parseInt(form.get("duration") as string),
      price: parseFloat(form.get("price") as string),
      description: form.get("description") as string,
      currency,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Services</h1>
          <p className="text-muted-foreground">Manage your service offerings</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" />Add Service</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Service</DialogTitle></DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              <SpamProtectionFields {...SpamProtectionFieldsProps} />
              <div className="space-y-2">
                <Label>Name</Label>
                <Input name="name" required placeholder="Haircut" maxLength={100} minLength={2} />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input name="description" placeholder="Standard haircut & styling" maxLength={500} />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Duration (min)</Label>
                  <Input name="duration" type="number" required defaultValue="30" min="5" max="480" />
                </div>
                <div className="space-y-2">
                  <Label>Price ({getCurrencySymbol(currency)})</Label>
                  <Input name="price" type="number" step="0.01" required defaultValue="25" min="0" max="99999" />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={addService.isPending}>
                {addService.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Service
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : services.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No services yet. Add your first service.</CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => (
            <Card key={s.id}>
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="flex items-center gap-2">
                  <Scissors className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">{s.name}</CardTitle>
                </div>
                <Button variant="ghost" size="icon" onClick={() => deleteService.mutate(s.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-1 text-sm text-muted-foreground">
                {s.description && <p>{s.description}</p>}
                <div className="flex items-center gap-4 pt-1">
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{s.duration_minutes} min</span>
                  <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />{getCurrencySymbol((s as any).currency || "usd")}{Number(s.price).toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
