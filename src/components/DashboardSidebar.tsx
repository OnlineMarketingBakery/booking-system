import {
  LayoutDashboard,
  MapPin,
  Users,
  Scissors,
  Calendar,
  Settings,
  LogOut,
  Code,
  UserCheck,
  BookOpen,
  Shield,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

const ownerNavItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Bookings", url: "/dashboard/bookings", icon: BookOpen },
  { title: "Locations", url: "/dashboard/locations", icon: MapPin },
  { title: "Staff", url: "/dashboard/staff", icon: Users },
  { title: "Services", url: "/dashboard/services", icon: Scissors },
  { title: "Calendar", url: "/dashboard/calendar", icon: Calendar },
  { title: "Embed", url: "/dashboard/embed", icon: Code },
  { title: "Customers", url: "/dashboard/customers", icon: UserCheck },
  { title: "Settings", url: "/dashboard/settings", icon: Settings },
];

const adminNavItems = [
  // { title: "Overview", url: "/dashboard", icon: LayoutDashboard },
  { title: "Admin Panel", url: "/dashboard", icon: Shield },
  { title: "Settings", url: "/dashboard/settings", icon: Settings },
];

const staffNavItems = [
  { title: "My Bookings", url: "/dashboard", icon: BookOpen },
];

export function DashboardSidebar() {
  const { signOut, hasRole } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const isSuperAdmin = hasRole("super_admin");
  const isOwner = hasRole("salon_owner") || isSuperAdmin;
  const navItems = isSuperAdmin ? adminNavItems : isOwner ? ownerNavItems : staffNavItems;

  return (
    <Sidebar collapsible="icon">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <Scissors className="h-4 w-4" />
        </div>
        {!collapsed && <span className="font-semibold text-sidebar-foreground">GlowBook</span>}
      </div>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <NavLink
                      to={item.url}
                      end={item.url === "/dashboard"}
                      className="flex items-center gap-2 rounded-[4px] px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border  p-2">
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "default"}
          className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && (<span className="ml-2">Sign Out</span>)}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
