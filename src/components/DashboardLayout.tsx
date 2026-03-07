import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { useAuth } from "@/contexts/AuthContext";

export function DashboardLayout() {
  const { user } = useAuth();

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <DashboardSidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <header className="flex h-14 items-center gap-4 border-b bg-card px-4">
            <SidebarTrigger />
            <div className="ml-auto text-sm text-muted-foreground">
              {user?.email}
            </div>
          </header>
          <main className="flex-1 overflow-auto p-6 min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
