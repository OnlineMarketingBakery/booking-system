import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Scissors, Calendar, CreditCard, Code, ArrowRight } from "lucide-react";

export default function Index() {
  const features = [
    { icon: Calendar, title: "Smart Scheduling", desc: "Automated availability & conflict-free bookings" },
    { icon: Scissors, title: "Multi-Location", desc: "Manage multiple salon branches from one dashboard" },
    { icon: CreditCard, title: "Online Payments", desc: "Accept payments seamlessly with Stripe" },
    { icon: Code, title: "Embeddable Widget", desc: "Add booking to your website with one line of code" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Scissors className="h-5 w-5" />
          </div>
          <span className="text-lg font-bold">GlowBook</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/auth">
            <Button variant="ghost" size="sm">Sign In</Button>
          </Link>
          <Link to="/auth">
            <Button size="sm">Get Started</Button>
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <div className="inline-block rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-accent-foreground mb-6">
          ✨ Multi-tenant salon booking platform
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
          Booking software that<br />
          <span className="text-primary">grows with your salon</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          Manage staff, locations, services, and appointments — all from one beautiful dashboard. Let your customers book and pay online.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link to="/auth">
            <Button size="lg">
              Start Free <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-6 space-y-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
