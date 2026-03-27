import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  MapPin,
  Users,
  Scissors,
  Calendar,
  CalendarOff,
  Settings,
  LogOut,
  Code,
  UserCheck,
  BookOpen,
  Shield,
  ChevronRight,
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const ownerNavItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Locations", url: "/dashboard/locations", icon: MapPin },
  { title: "Staff", url: "/dashboard/staff", icon: Users },
  { title: "Services", url: "/dashboard/services", icon: Scissors },
  { title: "Calendar", url: "/dashboard/calendar", icon: Calendar },
  { title: "Holidays", url: "/dashboard/holidays", icon: CalendarOff },
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

const sidebarLinkClass =
  "flex min-w-0 flex-1 items-center gap-2 rounded-[4px] px-2 py-2 text-sm text-sidebar-primary transition-colors hover:bg-sidebar-accent hover:text-sidebar-primary";
const sidebarLinkActiveClass = "bg-sidebar-accent font-medium !text-sidebar-primary";

function BookingsNavGroup() {
  const location = useLocation();
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const [bookingsSubOpen, setBookingsSubOpen] = useState(true);

  useEffect(() => {
    if (location.pathname.startsWith("/dashboard/bookings/settings")) {
      setBookingsSubOpen(true);
    }
  }, [location.pathname]);

  const listOnlyActive = location.pathname === "/dashboard/bookings";
  const settingsActive = location.pathname === "/dashboard/bookings/settings";

  const combinedBarClass = cn(
    "peer/menu-button flex h-8 w-full min-w-0 items-stretch overflow-hidden rounded-[4px] text-sm outline-none transition-[color,background-color,box-shadow]",
    listOnlyActive
      ? "bg-sidebar-accent font-medium text-sidebar-primary"
      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary",
  );

  return (
    <SidebarMenuItem>
      <Collapsible open={bookingsSubOpen} onOpenChange={setBookingsSubOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={`${combinedBarClass}`}>
              
              <NavLink
                to="/dashboard/bookings"
                end
                className={cn(
                  "flex min-w-0 flex-1 items-center justify-start gap-2 px-2 text-inherit no-underline outline-none transition-colors",
                  "hover:bg-transparent focus-visible:bg-transparent",
                  collapsed && "justify-center px-0",
                )}
              >
                <CollapsibleTrigger asChild>
                {/* <button
                  type="button"
                  className={cn(
                    "group-data-[collapsible=icon]:hidden",
                    "inline-flex w-8 shrink-0 items-center justify-center border-r border-sidebar-border/40 bg-transparent text-inherit outline-none transition-colors",
                    "hover:bg-black/[0.06] dark:hover:bg-white/[0.08]",
                    listOnlyActive && "border-sidebar-accent-foreground/25",
                  )}
                  aria-expanded={bookingsSubOpen}
                  aria-label={bookingsSubOpen ? "Collapse booking options" : "Expand booking options"}
                > */}
                  <ChevronRight
                    className={cn("group-data-[collapsible=icon]:hidden inline-flex w-8 shrink-0 items-center justify-center bg-transparent text-inherit outline-none transition-colors h-4 w-4 shrink-0 opacity-90 transition-transform duration-200", bookingsSubOpen && "rotate-90")}
                  />
                {/* </button> */}
              </CollapsibleTrigger>
                <BookOpen className="h-4 w-4 shrink-0 opacity-90" />
                
                {!collapsed && <span className="truncate">Bookings</span>}
              </NavLink>
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" align="center" hidden={state !== "collapsed" || isMobile}>
            Bookings
          </TooltipContent>
        </Tooltip>
        <CollapsibleContent className="group-data-[collapsible=icon]:hidden">
          <SidebarMenuSub className="mx-3.5 mt-0.5 border-sidebar-border">
            <SidebarMenuSubItem>
              <SidebarMenuSubButton asChild isActive={settingsActive} size="md">
                <NavLink
                  to="/dashboard/bookings/settings"
                  className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary rounded-[4px]"
                  activeClassName={sidebarLinkActiveClass}
                >
                  {!collapsed && <>Booking settings</>}
                </NavLink>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}

export function DashboardSidebar() {
  const { signOut, hasRole } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const isSuperAdmin = hasRole("super_admin");
  const isOwner = hasRole("salon_owner") || isSuperAdmin;
  const navItems = isSuperAdmin ? adminNavItems : isOwner ? ownerNavItems : staffNavItems;
  const showBookingsGroup = isOwner && !isSuperAdmin;
  const firstNavItem = showBookingsGroup ? navItems[0] : null;
  const restNavItems = showBookingsGroup ? navItems.slice(1) : navItems;
  const FirstNavIcon = firstNavItem?.icon;

  return (
    <Sidebar collapsible="icon">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <img src="/logo.png" alt="Salonora" className="h-8 w-5.5 object-contain" />
        
        {!collapsed && <img src="/salonora.png" alt="Salonora" className="h-5 object-contain" />}
      </div>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {showBookingsGroup && firstNavItem && FirstNavIcon ? (
                <>
                  <SidebarMenuItem key={firstNavItem.title}>
                    <SidebarMenuButton asChild tooltip={firstNavItem.title}>
                      <NavLink
                        to={firstNavItem.url}
                        end={firstNavItem.url === "/dashboard"}
                        className="flex items-center gap-2 rounded-[4px] px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-primary"
                        activeClassName={sidebarLinkActiveClass}
                      >
                        <FirstNavIcon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>{firstNavItem.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <BookingsNavGroup />
                  {restNavItems.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild tooltip={item.title}>
                        <NavLink
                          to={item.url}
                          end={item.url === "/dashboard"}
                          className="flex items-center gap-2 rounded-[4px] px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-primary"
                          activeClassName={sidebarLinkActiveClass}
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          {!collapsed && <span>{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </>
              ) : (
                navItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild tooltip={item.title}>
                      <NavLink
                        to={item.url}
                        end={item.url === "/dashboard"}
                        className="flex items-center gap-2 rounded-[4px] px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-primary"
                        activeClassName={sidebarLinkActiveClass}
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              )}
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
