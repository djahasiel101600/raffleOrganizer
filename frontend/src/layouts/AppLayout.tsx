import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  LogOut,
  MonitorPlay,
  PenTool,
  Printer,
  Settings,
  TicketPlus,
  Ticket as TicketIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/reservations/new", label: "New Reservation", icon: TicketPlus },
  { to: "/reservations", label: "Reservations", icon: TicketIcon },
  { to: "/monitor", label: "Ticket Monitor", icon: MonitorPlay },
  { to: "/print", label: "Print Center", icon: Printer, end: true },
  { to: "/designer", label: "Ticket Designer", icon: PenTool },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r bg-card md:flex">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <Printer className="h-5 w-5 text-primary" />
          <div className="leading-tight">
            <div className="text-sm font-bold">Raffle Reservation</div>
            <div className="text-xs text-muted-foreground">Admin</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-accent"
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3">
          <Button variant="ghost" className="w-full justify-start" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </aside>

      {/* Top bar for small screens */}
      <header className="flex h-14 items-center justify-between border-b bg-card px-4 md:hidden">
        <span className="text-sm font-bold">Raffle Reservation</span>
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          <LogOut className="h-4 w-4" />
        </Button>
      </header>

      <div className="md:pl-60">
        <main className="mx-auto max-w-6xl p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Simple mobile navigation row shown under the top bar on small screens. */
export function MobileNav() {
  return (
    <nav className="no-print flex gap-1 overflow-x-auto border-b bg-card p-2 md:hidden">
      {navItems.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium",
              isActive ? "bg-primary text-primary-foreground" : "text-foreground"
            )
          }
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}