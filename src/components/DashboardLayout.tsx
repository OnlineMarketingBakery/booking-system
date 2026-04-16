import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { PostSetupWizard } from "@/components/PostSetupWizard";
import { useAuth } from "@/contexts/AuthContext";

function initialsFromDisplayName(name: string | undefined | null): string {
  const t = name?.trim();
  if (!t) return "?";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  const a = parts[0][0];
  const b = parts[parts.length - 1][0];
  return `${a ?? ""}${b ?? ""}`.toUpperCase() || "?";
}

export function DashboardLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (user?.must_change_password && !location.pathname.startsWith("/dashboard/settings")) {
      navigate("/dashboard/settings/general", { replace: true });
    }
  }, [user?.must_change_password, location.pathname, navigate, user]);

  const initials = initialsFromDisplayName(user?.full_name);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <DashboardSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border/70 bg-background/90 px-3 shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-background/75 sm:px-5">
            <SidebarTrigger className="-ml-0.5 h-9 w-9 shrink-0 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&>svg]:size-5" />
            <div className="ml-auto flex items-center gap-2">
              <div className="flex items-center gap-2.5 rounded-full border border-border/70 bg-muted/35 py-1 pl-1 pr-3 shadow-sm dark:bg-muted/20">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/25 to-primary/10 text-[11px] font-semibold text-primary ring-1 ring-primary/20"
                  aria-hidden
                >
                  {initials}
                </div>
                <span className="hidden max-w-[10rem] truncate text-sm font-medium text-foreground sm:inline">
                  {user?.full_name}
                </span>
              </div>
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-auto bg-dashboard-canvas p-5 md:p-8">
            <PostSetupWizard />
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
