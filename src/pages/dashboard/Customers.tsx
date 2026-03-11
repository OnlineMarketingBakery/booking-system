import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, Phone, Calendar, Bell, Send } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CustomerRecord {
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  total_bookings: number;
  last_booking: string;
  statuses: string[];
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

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["customers", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("customer_name, customer_email, customer_phone, start_time, status")
        .eq("organization_id", organization!.id)
        .order("start_time", { ascending: false });
      if (error) throw error;

      // Group by email
      const map = new Map<string, CustomerRecord>();
      for (const b of data) {
        const existing = map.get(b.customer_email);
        if (existing) {
          existing.total_bookings++;
          if (!existing.statuses.includes(b.status)) existing.statuses.push(b.status);
        } else {
          map.set(b.customer_email, {
            customer_name: b.customer_name,
            customer_email: b.customer_email,
            customer_phone: b.customer_phone,
            total_bookings: 1,
            last_booking: b.start_time,
            statuses: [b.status],
          });
        }
      }
      return Array.from(map.values());
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
                        {format(new Date(c.last_booking), "MMM d, yyyy")}
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
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" className="gap-2" onClick={openSendEmail}>
                    <Send className="h-4 w-4" />
                    Send email
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
                      <span>{selectedCustomer.total_bookings} booking(s) · Last visit {format(new Date(selectedCustomer.last_booking), "MMM d, yyyy")}</span>
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
    </div>
  );
}
