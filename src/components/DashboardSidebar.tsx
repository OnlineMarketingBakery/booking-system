import {
  LayoutDashboard,
  MapPin,
  Users,
  Scissors,
  Calendar,
  Settings,
  LogOut,
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
  { title: "Calendar", url: "/dashboard/calendar", icon: Calendar },
  { title: "Bookings", url: "/dashboard/bookings", icon: BookOpen },
  { title: "Locations", url: "/dashboard/locations", icon: MapPin },
  { title: "Staff", url: "/dashboard/staff", icon: Users },
  { title: "Services", url: "/dashboard/services", icon: Scissors },
  { title: "Customers", url: "/dashboard/customers", icon: UserCheck },
  { title: "Settings", url: "/dashboard/settings", icon: Settings },
];

const adminNavItems = [
  { title: "Admin Panel", url: "/dashboard", icon: Shield },
  { title: "Settings", url: "/dashboard/settings", icon: Settings },
];

const staffNavItems = [{ title: "My Bookings", url: "/dashboard", icon: BookOpen }];

const sidebarLinkActiveClass =
  "relative rounded-lg bg-primary/20 font-medium !text-white shadow-[inset_0_0_0_1px_rgba(57,144,240,0.35)] before:absolute before:left-1 before:top-1/2 before:h-6 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-[#3990F0]";

const navLinkClass =
  "mx-0.5 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/90 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

export function DashboardSidebar() {
  const { signOut, hasRole } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const isSuperAdmin = hasRole("super_admin");
  const isOwner = hasRole("salon_owner") || isSuperAdmin;
  const navItems = isSuperAdmin ? adminNavItems : isOwner ? ownerNavItems : staffNavItems;

  return (
    <Sidebar collapsible="icon">
      <div className="flex h-[3.25rem] items-center gap-2.5 border-b border-sidebar-border/80 bg-black/15 px-4">
        <img src="/logo.png" alt="" className="h-8 w-5.5 object-contain opacity-95" aria-hidden />
        {!collapsed && (
          <img src="/salonora.png" alt="Salonora" className="h-[1.15rem] object-contain opacity-90 drop-shadow-[0_1px_8px_rgba(0,0,0,0.35)]" />
        )}
      </div>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/45">
            Menu
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <NavLink
                      to={item.url}
                      end={item.url === "/dashboard"}
                      className={navLinkClass}
                      activeClassName={sidebarLinkActiveClass}
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

      <SidebarFooter className="border-t border-sidebar-border/80 bg-black/10 p-2">
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "default"}
          className="w-full justify-start rounded-lg text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="ml-2">Sign Out</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
