import { useAuth } from "@/contexts/AuthContext";
import Overview from "./Overview";
import StaffPortal from "./StaffPortal";

export default function DashboardIndex() {
  const { hasRole } = useAuth();
  const isOwner = hasRole("salon_owner") || hasRole("super_admin");

  if (isOwner) return <Overview />;
  return <StaffPortal />;
}
