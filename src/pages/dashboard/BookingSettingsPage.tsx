import { Link } from "react-router-dom";
import { ArrowRight, Calendar, CalendarOff, Code, UserCheck } from "lucide-react";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BookingAutomationCards } from "@/components/dashboard/BookingAutomationCards";
import { BookingBreakTimesSection } from "@/components/dashboard/BookingBreakTimesSection";

// const relatedLinks = [
//   {
//     title: "Calendar",
//     description: "View and manage appointments on the schedule.",
//     to: "/dashboard/calendar",
//     icon: Calendar,
//   },
//   {
//     title: "Holidays & off days",
//     description: "Public holidays, custom closures, and availability.",
//     to: "/dashboard/holidays",
//     icon: CalendarOff,
//   },
//   {
//     title: "Embed",
//     description: "Colors and code for your public booking widget.",
//     to: "/dashboard/embed",
//     icon: Code,
//   },
//   {
//     title: "Customers",
//     description: "Per-customer reminder overrides.",
//     to: "/dashboard/customers",
//     icon: UserCheck,
//   },
// ] as const;

export default function BookingSettingsPage() {
  const { organization } = useOrganization();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Booking settings</h1>
        <p className="text-muted-foreground">
          {organization
            ? "Reminders, calendar sync, and shortcuts to other booking tools"
            : "Loading organization…"}
        </p>
      </div>


      <BookingBreakTimesSection />
      <BookingAutomationCards />

      {/* <Card>
        <CardHeader>
          <CardTitle>Related pages</CardTitle>
          <CardDescription>Open other areas that affect how customers book and how appointments run.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {relatedLinks.map(({ title, description, to, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50"
            >
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 font-medium">
                  {title}
                  <ArrowRight className="h-4 w-4 shrink-0 opacity-60" />
                </span>
                <span className="block text-sm text-muted-foreground">{description}</span>
              </span>
            </Link>
          ))}
        </CardContent>
      </Card> */}
    </div>
  );
}
