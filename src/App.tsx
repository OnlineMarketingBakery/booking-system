import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
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
import Locations from "./pages/dashboard/Locations";
import Staff from "./pages/dashboard/Staff";
import Services from "./pages/dashboard/Services";
import CalendarPage from "./pages/dashboard/CalendarPage";
import Embed from "./pages/dashboard/Embed";
import SettingsPage from "./pages/dashboard/SettingsPage";
import HolidaysPage from "./pages/dashboard/HolidaysPage";
import Customers from "./pages/dashboard/Customers";
import SuperAdminDashboard from "./pages/dashboard/SuperAdminDashboard";
import BookingPage from "./pages/BookingPage";
import ThankYouPage from "./pages/ThankYouPage";
import ConfirmBookingPage from "./pages/ConfirmBookingPage";
import ReleaseHoldPage from "./pages/ReleaseHoldPage";
import GoogleOAuthRedirect from "./pages/GoogleOAuthRedirect";
import AcceptStaffInvite from "./pages/AcceptStaffInvite";

const queryClient = new QueryClient();

const App = () => (
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
              <Route path="bookings" element={<Bookings />} />
              <Route path="staff" element={<Staff />} />
              <Route path="services" element={<Services />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="embed" element={<Embed />} />
              <Route path="holidays" element={<HolidaysPage />} />
              <Route path="customers" element={<Customers />} />
              <Route path="admin" element={<SuperAdminDashboard />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
