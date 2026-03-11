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
          <header className="flex h-14 items-center gap-4 bg-sidebar px-4">
            <SidebarTrigger className="text-white hover:bg-white hover:text-sidebar-primary rounded-[4px]" />
            <div className="ml-auto text-sm text-white">
              {user?.full_name}
            </div>
          </header>
          <main className="flex-1 overflow-auto p-6 min-w-0 bg-[#EBF3FE]">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
