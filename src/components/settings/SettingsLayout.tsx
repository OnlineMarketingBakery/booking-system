import { Outlet, NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useOrganization } from "@/hooks/useOrganization";

const navClass =
  "block rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted/80 text-foreground/90";
const navActive = "bg-primary/10 font-medium text-primary hover:bg-primary/15";

function NavItem({ to, end, children }: { to: string; end?: boolean; children: React.ReactNode }) {
  return (
    <NavLink to={to} className={({ isActive }) => cn(navClass, isActive && navActive)} end={end}>
      {children}
    </NavLink>
  );
}

export function SettingsLayout() {
  const { organization } = useOrganization();

  return (
    <div className="mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">
          {organization ? "Manage your salon, integrations, and online tools." : "Manage your account."}
        </p>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 space-y-6 lg:sticky lg:top-4 lg:w-56">
          <nav className="rounded-xl border bg-card p-3 shadow-sm space-y-6">
            <div>
              <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">General</p>
              <div className="space-y-0.5">
                <NavItem to="/dashboard/settings/general" end>
                  General
                </NavItem>
                {organization ? <NavItem to="/dashboard/settings/integrations">Integrations</NavItem> : null}
              </div>
            </div>
            {organization ? (
              <>
                <div>
                  <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bookings</p>
                  <div className="space-y-0.5">
                    <NavItem to="/dashboard/settings/booking-settings">Booking settings</NavItem>
                  </div>
                </div>
                <div>
                  <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Calendar</p>
                  <div className="space-y-0.5">
                    <NavItem to="/dashboard/settings/holidays">Holidays</NavItem>
                  </div>
                </div>
                <div>
                  <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Online</p>
                  <div className="space-y-0.5">
                    <NavItem to="/dashboard/settings/embed">Booking widget</NavItem>
                  </div>
                </div>
              </>
            ) : null}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 space-y-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
