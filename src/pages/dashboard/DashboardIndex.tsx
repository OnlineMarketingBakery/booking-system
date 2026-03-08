import { useAuth } from "@/contexts/AuthContext";
import Overview from "./Overview";
import StaffPortal from "./StaffPortal";
import SuperAdminDashboard from "./SuperAdminDashboard";

export default function DashboardIndex() {
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const isOwner = hasRole("salon_owner");

  if (isSuperAdmin) return <SuperAdminDashboard />;
  if (isOwner) return <Overview />;
  return <StaffPortal />;
}
