import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AuthProvider } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Toaster } from "@/components/ui/sonner";
import { AppLayout } from "@/layouts/AppLayout";

import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import NewReservation from "@/pages/NewReservation";
import Reservations from "@/pages/Reservations";
import ReservationDetails from "@/pages/ReservationDetails";
import TicketMonitor from "@/pages/TicketMonitor";
import PrintCenter from "@/pages/PrintCenter";
import PrintPreview from "@/pages/PrintPreview";
import TicketDesigner from "@/pages/TicketDesigner";
import Settings from "@/pages/Settings";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/reservations/new" element={<NewReservation />} />
            <Route path="/reservations" element={<Reservations />} />
            <Route path="/reservations/:id" element={<ReservationDetails />} />
            <Route path="/monitor" element={<TicketMonitor />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/print" element={<PrintCenter />} />
            <Route path="/print/:id" element={<PrintPreview />} />
            <Route path="/designer" element={<TicketDesigner />} />
          </Route>
          <Route path="*" element={<Login />} />
        </Routes>
      </BrowserRouter>
      <div className="pointer-events-none fixed inset-0 z-[100] flex justify-center">
        <Toaster />
      </div>
    </AuthProvider>
  );
}