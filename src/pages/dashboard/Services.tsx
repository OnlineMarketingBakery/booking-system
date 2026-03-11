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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Plus, Scissors, Trash2, Loader2, Clock, DollarSign, Percent, Pencil } from "lucide-react";

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

const getCurrencySymbol = (code: string) => CURRENCIES.find(c => c.value === code)?.symbol || "€";

export default function Services() {
  const { organization } = useOrganization();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingService, setEditingService] = useState<{
    id: string;
    name: string;
    description: string | null;
    duration_minutes: number;
    price: number;
    currency: string;
    vat_rate_id?: string | null;
  } | null>(null);
  const [selectedVatRateId, setSelectedVatRateId] = useState<string | null>(null);
  const { validateSpamProtection, SpamProtectionFieldsProps } = useSpamProtection();

  const { data: vatRates = [] } = useQuery({
    queryKey: ["vat-rates", organization?.id],
    queryFn: async () => {
      if (!organization) return [];
      const { data, error } = await supabase
        .from("vat_rates")
        .select("id, name, percentage, is_default, percentage_disabled")
        .eq("organization_id", organization.id)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organization,
  });

  const defaultVatRateId = vatRates.find((r) => r.is_default)?.id ?? (vatRates[0] as { id: string } | undefined)?.id ?? null;

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
    mutationFn: async (values: { name: string; duration_minutes: number; price: number; description: string; currency: string; vat_rate_id: string | null }) => {
      const { error } = await supabase
        .from("services")
        .insert({ ...values, organization_id: organization!.id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services"] });
      setOpen(false);
      setEditingService(null);
      toast({ title: "Service added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateService = useMutation({
    mutationFn: async (values: { id: string; name: string; duration_minutes: number; price: number; description: string; currency: string; vat_rate_id: string | null }) => {
      const { id, ...rest } = values;
      const { error } = await supabase
        .from("services")
        .update(rest)
        .eq("id", id)
        .eq("organization_id", organization!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services"] });
      setOpen(false);
      setEditingService(null);
      toast({ title: "Service updated" });
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

  const [currency, setCurrency] = useState("eur");

  const isEdit = !!editingService;

  const openAddDialog = () => {
    setEditingService(null);
    setSelectedVatRateId(defaultVatRateId);
    setCurrency("eur");
    setOpen(true);
  };

  const openEditDialog = (s: typeof services[0]) => {
    setEditingService({
      id: s.id,
      name: s.name,
      description: (s as { description?: string | null }).description ?? "",
      duration_minutes: s.duration_minutes,
      price: s.price,
      currency: (s as { currency?: string }).currency ?? "eur",
      vat_rate_id: (s as { vat_rate_id?: string | null }).vat_rate_id ?? null,
    });
    setSelectedVatRateId((s as { vat_rate_id?: string | null }).vat_rate_id ?? defaultVatRateId);
    setCurrency((s as { currency?: string }).currency ?? "eur");
    setOpen(true);
  };

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!validateSpamProtection(form)) {
      toast({ title: "Please wait a moment", description: "Then try again.", variant: "destructive" });
      return;
    }
    const payload = {
      name: form.get("name") as string,
      duration_minutes: parseInt(form.get("duration") as string),
      price: parseFloat(form.get("price") as string),
      description: form.get("description") as string,
      currency,
      vat_rate_id: selectedVatRateId || null,
    };
    if (editingService) {
      updateService.mutate({ ...payload, id: editingService.id });
    } else {
      addService.mutate(payload);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Services</h1>
          <p className="text-muted-foreground">Manage your service offerings</p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(isOpen) => {
            if (!isOpen) setEditingService(null);
            setOpen(isOpen);
            if (isOpen && !editingService) setSelectedVatRateId(defaultVatRateId);
          }}
        >
          <DialogTrigger asChild>
            <Button onClick={openAddDialog}><Plus className="mr-2 h-4 w-4" />Add Service</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{isEdit ? "Edit Service" : "Add Service"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              <SpamProtectionFields {...SpamProtectionFieldsProps} />
              <div className="space-y-2">
                <Label>Name</Label>
                <Input name="name" required placeholder="Haircut" maxLength={100} minLength={2} defaultValue={editingService?.name} key={editingService?.id ?? "new"} />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input name="description" placeholder="Standard haircut & styling" maxLength={500} defaultValue={editingService?.description ?? ""} key={`desc-${editingService?.id ?? "new"}`} />
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
                  <Input name="duration" type="number" required min="5" max="480" defaultValue={editingService?.duration_minutes ?? 30} key={`dur-${editingService?.id ?? "new"}`} />
                </div>
                <div className="space-y-2">
                  <Label>Price ({getCurrencySymbol(currency)})</Label>
                  <Input name="price" type="number" step="0.01" required min="0" max="99999" defaultValue={editingService?.price ?? 25} key={`price-${editingService?.id ?? "new"}`} />
                </div>
              </div>
              {vatRates.length > 0 && (
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Percent className="h-3.5 w-3.5" />
                    VAT rate
                  </Label>
                  <RadioGroup
                    value={selectedVatRateId ?? "none"}
                    onValueChange={(val) => setSelectedVatRateId(val === "none" ? null : val)}
                    className="grid gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="none" id="vat-none" />
                      <Label htmlFor="vat-none" className="font-normal cursor-pointer">None (No VAT)</Label>
                    </div>
                    {vatRates.map((rate) => (
                      <div key={rate.id} className="flex items-center gap-2">
                        <RadioGroupItem value={rate.id} id={`vat-${rate.id}`} />
                        <Label htmlFor={`vat-${rate.id}`} className="font-normal cursor-pointer">
                          {rate.name}
                          {rate.percentage_disabled ? "" : ` (${Number(rate.percentage).toFixed(0)}%)`}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
              )}
              <Button type="submit" className="w-full" disabled={addService.isPending || updateService.isPending}>
                {(addService.isPending || updateService.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEdit ? "Save changes" : "Add Service"}
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
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEditDialog(s)} title="Edit service">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteService.mutate(s.id)} title="Delete service">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-1 text-sm text-muted-foreground">
                {s.description && <p>{s.description}</p>}
                <div className="flex items-center gap-4 pt-1">
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{s.duration_minutes} min</span>
                  <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />{getCurrencySymbol((s as any).currency || "eur")}{Number(s.price).toFixed(2)}</span>
                  {(s as { vat_rate_id?: string | null }).vat_rate_id && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Percent className="h-3 w-3" />
                      {vatRates.find((r) => r.id === (s as { vat_rate_id?: string | null }).vat_rate_id)?.name ?? "VAT"}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
