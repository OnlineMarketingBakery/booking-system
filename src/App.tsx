import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DashboardLayout } from "@/components/DashboardLayout";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import ResetPassword from "./pages/ResetPassword";
import ConfirmPasswordChange from "./pages/ConfirmPasswordChange";
import DashboardIndex from "./pages/dashboard/DashboardIndex";
import Bookings from "./pages/dashboard/Bookings";
import BookingsLayout from "./pages/dashboard/BookingsLayout";
import BookingSettingsPage from "./pages/dashboard/BookingSettingsPage";
import Locations from "./pages/dashboard/Locations";
import Staff from "./pages/dashboard/Staff";
import Services from "./pages/dashboard/Services";
import CalendarPage from "./pages/dashboard/CalendarPage";
import Embed from "./pages/dashboard/Embed";
import SettingsPage from "./pages/dashboard/SettingsPage";
import { SettingsLayout } from "./components/settings/SettingsLayout";
import IntegrationsPage from "./pages/dashboard/IntegrationsPage";
import HolidaysPage from "./pages/dashboard/HolidaysPage";
import Customers from "./pages/dashboard/Customers";
import PlansPage from "./pages/dashboard/PlansPage";
import AuditLogPage from "./pages/dashboard/AuditLogPage";
import SuperAdminDashboard from "./pages/dashboard/SuperAdminDashboard";
import BookingPage from "./pages/BookingPage";
import ThankYouPage from "./pages/ThankYouPage";
import ConfirmBookingPage from "./pages/ConfirmBookingPage";
import ReleaseHoldPage from "./pages/ReleaseHoldPage";
import GoogleOAuthRedirect from "./pages/GoogleOAuthRedirect";
import AcceptStaffInvite from "./pages/AcceptStaffInvite";
import CompletePurchaseSignup from "./pages/CompletePurchaseSignup";

const queryClient = new QueryClient();

const App = () => {
  return (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* <Route path="/" element={<Index />} /> */}
            <Route path="/" element={<Auth />} />
            <Route path="/book/:slug" element={<BookingPage />} />
            <Route path="/book/success" element={<ThankYouPage />} />
            <Route path="/book/confirm" element={<ConfirmBookingPage />} />
            <Route path="/book/release-hold" element={<ReleaseHoldPage />} />
            <Route path="/book/cancel" element={<BookingPage />} />
            <Route path="/auth/google-callback" element={<GoogleOAuthRedirect />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/complete-purchase-signup" element={<CompletePurchaseSignup />} />
            <Route path="/confirm-password-change" element={<ConfirmPasswordChange />} />
            <Route path="/accept-staff-invite" element={<AcceptStaffInvite />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardIndex />} />
              <Route path="locations" element={<Locations />} />
              <Route path="bookings" element={<BookingsLayout />}>
                <Route index element={<Bookings />} />
                <Route path="settings" element={<Navigate to="/dashboard/settings/booking-settings" replace />} />
              </Route>
              <Route path="staff" element={<Staff />} />
              <Route path="services" element={<Services />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="embed" element={<Navigate to="/dashboard/settings/embed" replace />} />
              <Route path="holidays" element={<Navigate to="/dashboard/settings/holidays" replace />} />
              <Route path="customers" element={<Customers />} />
              <Route path="plans" element={<Navigate to="/dashboard/settings/plans" replace />} />
              <Route path="admin" element={<SuperAdminDashboard />} />
              <Route path="settings" element={<SettingsLayout />}>
                <Route index element={<Navigate to="general" replace />} />
                <Route path="general" element={<SettingsPage />} />
                <Route path="integrations" element={<IntegrationsPage />} />
                <Route path="holidays" element={<HolidaysPage />} />
                <Route path="embed" element={<Embed />} />
                <Route path="booking-settings" element={<BookingSettingsPage />} />
                <Route path="plans" element={<PlansPage />} />
                <Route path="audit" element={<AuditLogPage />} />
              </Route>
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>)
};

export default App;
