import { useState } from "react";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Scissors } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSpamProtection } from "@/hooks/useSpamProtection";
import { SpamProtectionFields } from "@/components/SpamProtectionFields";

export function OnboardingWizard() {
  const { createOrganization } = useOrganization();
  const { toast } = useToast();
  const { validateSpamProtection, SpamProtectionFieldsProps } = useSpamProtection();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  const generateSlug = (val: string) => {
    setName(val);
    setSlug(val.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!validateSpamProtection(e.currentTarget)) {
      toast({ title: "Please wait a moment", description: "Then try again.", variant: "destructive" });
      return;
    }
    try {
      await createOrganization.mutateAsync({ name, slug });
      toast({ title: "Salon created!", description: "Welcome to Salonora." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="flex items-center justify-center py-12">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Scissors className="h-7 w-7" />
          </div>
          <CardTitle className="text-2xl">Create Your Salon</CardTitle>
          <CardDescription>
            Set up your salon to start accepting bookings.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <SpamProtectionFields {...SpamProtectionFieldsProps} />
            <div className="space-y-2">
              <Label htmlFor="salon-name">Salon Name</Label>
              <Input
                id="salon-name"
                value={name}
                onChange={(e) => generateSlug(e.target.value)}
                placeholder="Luxe Hair Studio"
                required
                maxLength={100}
                minLength={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="salon-slug">Booking URL Slug</Label>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>booking.salonora.eu/book/</span>
                <Input
                  id="salon-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="luxe-hair-studio"
                  required
                  className="flex-1"
                  maxLength={50}
                  minLength={2}
                  pattern="[a-z0-9\-]+"
                  title="Only lowercase letters, numbers, and hyphens"
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={createOrganization.isPending}>
              {createOrganization.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Salon
            </Button>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}
