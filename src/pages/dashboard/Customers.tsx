import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, Phone, Calendar, Bell, Send, Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CustomerRecord {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  total_bookings: number;
  last_booking: string;
  statuses: string[];
}

function parseCustomerName(full: string): { firstName: string; lastName: string } {
  const parts = (full || "").trim().split(/\s+/);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") ?? "" };
}
function fullNameFromParts(first: string, last: string): string {
  return [first.trim(), last.trim()].filter(Boolean).join(" ").trim() || "";
}

const DEFAULT_EMAIL_SUBJECT = "A message from us";
const DEFAULT_EMAIL_MESSAGE = `Hi there,

We wanted to reach out and thank you for being a valued customer.

If you have any questions or would like to book another appointment, please don't hesitate to contact us.

Best regards`;

export default function Customers() {
  const { organization } = useOrganization();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRecord | null>(null);
  const [sendEmailOpen, setSendEmailOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState(DEFAULT_EMAIL_SUBJECT);
  const [emailMessage, setEmailMessage] = useState(DEFAULT_EMAIL_MESSAGE);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["customers", organization?.id],
    queryFn: async () => {
      const orgId = organization!.id;
      const { data: customerRows, error: custErr } = await supabase
        .from("confirmed_booking_customers")
        .select("id, customer_name, customer_email, customer_phone, updated_at")
        .eq("organization_id", orgId);
      if (custErr) throw custErr;

      const { data: bookingRows, error: bookErr } = await supabase
        .from("bookings")
        .select("customer_email, start_time, status")
        .eq("organization_id", orgId)
        .order("start_time", { ascending: false });
      if (bookErr) throw bookErr;

      const byEmail = new Map<string, { total_bookings: number; last_booking: string; statuses: string[] }>();
      for (const b of bookingRows || []) {
        const email = (b.customer_email || "").trim().toLowerCase();
        if (!email) continue;
        const existing = byEmail.get(email);
        if (existing) {
          existing.total_bookings++;
          if (!existing.statuses.includes(b.status)) existing.statuses.push(b.status);
        } else {
          byEmail.set(email, {
            total_bookings: 1,
            last_booking: b.start_time,
            statuses: [b.status],
          });
        }
      }

      const list: CustomerRecord[] = (customerRows || []).map((row) => {
        const email = (row.customer_email || "").trim().toLowerCase();
        const stats = byEmail.get(email);
        return {
          id: row.id,
          customer_name: row.customer_name || "",
          customer_email: row.customer_email || "",
          customer_phone: row.customer_phone ?? null,
          total_bookings: stats?.total_bookings ?? 0,
          last_booking: stats?.last_booking ?? row.updated_at,
          statuses: stats?.statuses ?? [],
        };
      });
      list.sort((a, b) => {
        const tA = new Date(a.last_booking).getTime();
        const tB = new Date(b.last_booking).getTime();
        if (!Number.isFinite(tA) && !Number.isFinite(tB)) return 0;
        if (!Number.isFinite(tA)) return 1;
        if (!Number.isFinite(tB)) return -1;
        return tB - tA;
      });
      return list;
    },
    enabled: !!organization,
  });

  const { data: reminderPrefs } = useQuery({
    queryKey: ["customer-reminder-prefs", organization?.id, selectedCustomer?.customer_email],
    queryFn: async () => {
      if (!organization || !selectedCustomer) return null;
      const { data } = await supabase
        .from("customer_reminder_preferences")
        .select("email_reminder_day_before, email_reminder_hour_before")
        .eq("organization_id", organization.id)
        .eq("customer_email", selectedCustomer.customer_email)
        .maybeSingle();
      return data;
    },
    enabled: !!organization && !!selectedCustomer,
  });

  const updateReminderPrefs = useMutation({
    mutationFn: async (payload: { email_reminder_day_before: boolean; email_reminder_hour_before: boolean }) => {
      if (!organization || !selectedCustomer) throw new Error("No customer selected");
      const { error } = await supabase
        .from("customer_reminder_preferences")
        .upsert(
          {
            organization_id: organization.id,
            customer_email: selectedCustomer.customer_email,
            ...payload,
          },
          { onConflict: "organization_id,customer_email" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-reminder-prefs"] });
      toast({ title: "Reminder preferences saved" });
    },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const dayBefore = reminderPrefs?.email_reminder_day_before ?? (organization as { reminder_email_day_before?: boolean })?.reminder_email_day_before ?? true;
  const hourBefore = reminderPrefs?.email_reminder_hour_before ?? (organization as { reminder_email_hour_before?: boolean })?.reminder_email_hour_before ?? true;

  const openSendEmail = () => {
    setEmailSubject(organization ? DEFAULT_EMAIL_SUBJECT.replace("us", organization.name) : DEFAULT_EMAIL_SUBJECT);
    setEmailMessage(DEFAULT_EMAIL_MESSAGE);
    setSendEmailOpen(true);
  };

  const sendCustomerEmail = useMutation({
    mutationFn: async () => {
      if (!organization || !selectedCustomer) throw new Error("No customer selected");
      const { data, error } = await supabase.functions.invoke("send-customer-email", {
        body: {
          organization_id: organization.id,
          customer_email: selectedCustomer.customer_email,
          customer_name: selectedCustomer.customer_name,
          subject: emailSubject.trim() || undefined,
          message: emailMessage.trim() || undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      setSendEmailOpen(false);
      toast({ title: "Email sent", description: "The message was sent to the customer." });
    },
    onError: (e) => toast({ title: "Failed to send email", description: (e as Error).message, variant: "destructive" }),
  });

  const openEditDialog = () => {
    if (!selectedCustomer) return;
    const { firstName, lastName } = parseCustomerName(selectedCustomer.customer_name);
    setEditFirstName(firstName);
    setEditLastName(lastName);
    setEditEmail(selectedCustomer.customer_email);
    setEditPhone(selectedCustomer.customer_phone ?? "");
    setEditDialogOpen(true);
  };

  const updateCustomer = useMutation({
    mutationFn: async () => {
      if (!organization || !selectedCustomer) throw new Error("No customer selected");
      const oldEmail = selectedCustomer.customer_email.trim().toLowerCase();
      const newEmail = editEmail.trim();
      const newEmailLower = newEmail.toLowerCase();
      const { error: updateErr } = await supabase
        .from("confirmed_booking_customers")
        .update({
          customer_name: fullNameFromParts(editFirstName, editLastName) || null,
          customer_email: newEmail,
          customer_phone: editPhone.trim() || null,
        })
        .eq("id", selectedCustomer.id);
      if (updateErr) throw updateErr;
      if (oldEmail !== newEmailLower) {
        const { data: prefs } = await supabase
          .from("customer_reminder_preferences")
          .select("email_reminder_day_before, email_reminder_hour_before")
          .eq("organization_id", organization.id)
          .eq("customer_email", selectedCustomer.customer_email)
          .maybeSingle();
        await supabase
          .from("customer_reminder_preferences")
          .delete()
          .eq("organization_id", organization.id)
          .eq("customer_email", selectedCustomer.customer_email);
        if (prefs) {
          await supabase.from("customer_reminder_preferences").upsert(
            {
              organization_id: organization.id,
              customer_email: newEmail,
              ...prefs,
            },
            { onConflict: "organization_id,customer_email" }
          );
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer-reminder-prefs"] });
      setEditDialogOpen(false);
      setSelectedCustomer(null);
      toast({ title: "Customer updated" });
    },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const deleteCustomer = useMutation({
    mutationFn: async () => {
      if (!organization || !selectedCustomer) throw new Error("No customer selected");
      await supabase
        .from("customer_reminder_preferences")
        .delete()
        .eq("organization_id", organization.id)
        .eq("customer_email", selectedCustomer.customer_email);
      const { error } = await supabase
        .from("confirmed_booking_customers")
        .delete()
        .eq("id", selectedCustomer.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setDeleteConfirmOpen(false);
      setSelectedCustomer(null);
      toast({ title: "Customer removed" });
    },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
        <p className="text-muted-foreground">View customer history and contact details</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : customers.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No customers yet.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="text-center">Bookings</TableHead>
                  <TableHead>Visit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow
                    key={c.customer_email}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedCustomer(c)}
                  >
                    <TableCell className="font-medium">{c.customer_name}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 text-sm">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Mail className="h-3 w-3" />{c.customer_email}
                        </span>
                        {c.customer_phone && (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Phone className="h-3 w-3" />{c.customer_phone}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{c.total_bookings}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {c.last_booking && !Number.isNaN(new Date(c.last_booking).getTime())
                          ? format(new Date(c.last_booking), "MMM d, yyyy")
                          : "—"}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Sheet open={!!selectedCustomer} onOpenChange={(open) => !open && setSelectedCustomer(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          {selectedCustomer && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedCustomer.customer_name}</SheetTitle>
                <SheetDescription>Customer details and reminder settings</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-6">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" className="gap-2" onClick={openSendEmail}>
                    <Send className="h-4 w-4" />
                    Send email
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="gap-2" onClick={openEditDialog}>
                    <Pencil className="h-4 w-4" />
                    Edit customer
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteConfirmOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete customer
                  </Button>
                </div>
                <div>
                  <h4 className="text-sm font-medium mb-2">Details</h4>
                  <div className="rounded-lg border p-4 space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span>{selectedCustomer.customer_email}</span>
                    </div>
                    {selectedCustomer.customer_phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <span>{selectedCustomer.customer_phone}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span>{selectedCustomer.total_bookings} booking(s) · Last visit {selectedCustomer.last_booking && !Number.isNaN(new Date(selectedCustomer.last_booking).getTime()) ? format(new Date(selectedCustomer.last_booking), "MMM d, yyyy") : "—"}</span>
                    </div>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <Bell className="h-4 w-4" />
                    Settings
                  </h4>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <Label className="text-base font-medium">Email reminder: day before appointment</Label>
                        <p className="text-sm text-muted-foreground">Send an email the day before the booking date.</p>
                      </div>
                      <Switch
                        checked={dayBefore}
                        onCheckedChange={(checked) => updateReminderPrefs.mutate({
                          email_reminder_day_before: !!checked,
                          email_reminder_hour_before: hourBefore,
                        })}
                        disabled={updateReminderPrefs.isPending}
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <Label className="text-base font-medium">Email reminder: 1 hour before</Label>
                        <p className="text-sm text-muted-foreground">Send an email one hour before the appointment time.</p>
                      </div>
                      <Switch
                        checked={hourBefore}
                        onCheckedChange={(checked) => updateReminderPrefs.mutate({
                          email_reminder_day_before: dayBefore,
                          email_reminder_hour_before: !!checked,
                        })}
                        disabled={updateReminderPrefs.isPending}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={sendEmailOpen} onOpenChange={setSendEmailOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send email to customer</DialogTitle>
            <DialogDescription>
              {selectedCustomer && (
                <>Sending to {selectedCustomer.customer_name} ({selectedCustomer.customer_email})</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="email-subject">Subject</Label>
              <Input
                id="email-subject"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="Email subject"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email-message">Message</Label>
              <textarea
                id="email-message"
                className="flex min-h-[180px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={emailMessage}
                onChange={(e) => setEmailMessage(e.target.value)}
                placeholder="Your message"
              />
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => { setEmailSubject(organization ? DEFAULT_EMAIL_SUBJECT.replace("us", organization.name) : DEFAULT_EMAIL_SUBJECT); setEmailMessage(DEFAULT_EMAIL_MESSAGE); }}>
              Use default message
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSendEmailOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => sendCustomerEmail.mutate()} disabled={sendCustomerEmail.isPending}>
              {sendCustomerEmail.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit customer</DialogTitle>
            <DialogDescription>Update name, email, or phone. Changing email updates reminder preferences only; past bookings keep the original email.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-first-name">First name</Label>
                <Input
                  id="edit-first-name"
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                  placeholder="First name"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-last-name">Last name</Label>
                <Input
                  id="edit-last-name"
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                  placeholder="Last name"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                placeholder="Email address"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-phone">Phone</Label>
              <Input
                id="edit-phone"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                placeholder="Phone (optional)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => updateCustomer.mutate()} disabled={updateCustomer.isPending}>
              {updateCustomer.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={(open) => !deleteCustomer.isPending && setDeleteConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this customer?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the customer from your list and their reminder preferences. Past bookings are not deleted and will still show their contact details.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCustomer.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteCustomer.mutate()}
              disabled={deleteCustomer.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteCustomer.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
