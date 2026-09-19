import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  MonitorPlay,
  Printer,
  Ticket as TicketIcon,
  TicketPlus,
} from "lucide-react";

import { fetchDashboard } from "@/services/dashboard";
import { useReservationSocket } from "@/services/websocket";
import { ConnectionIndicator } from "@/components/ConnectionIndicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, formatTime } from "@/lib/utils";
import type { DashboardStats } from "@/types";

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { status, subscribe } = useReservationSocket();

  const load = useCallback(async () => {
    try {
      setStats(await fetchDashboard());
      setError(null);
    } catch {
      setError("Unable to connect to the server. Please check your connection.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Refresh when a reservation changes anywhere in the system.
    const unsubscribe = subscribe(() => {
      void load();
    });
    return unsubscribe;
  }, [subscribe, load]);

  if (error) {
    return (
      <EmptyState
        title="Unable to connect"
        message={error}
        actionLabel="Retry"
        onAction={() => void load()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {stats?.raffle_name ?? "Raffle overview"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ConnectionIndicator status={status} />
          <Button onClick={() => navigate("/reservations/new")}>
            <TicketPlus className="h-4 w-4" />
            New Reservation
          </Button>
        </div>
      </div>

      {!stats ? (
        <StatsSkeleton />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total Tickets"
              value={formatNumber(stats.total_tickets)}
              icon={<TicketIcon className="h-5 w-5" />}
            />
            <StatCard
              label="Reserved"
              value={formatNumber(stats.reserved_tickets)}
              icon={<Printer className="h-5 w-5" />}
              accent="text-warning"
            />
            <StatCard
              label="Available"
              value={formatNumber(stats.available_tickets)}
              icon={<TicketPlus className="h-5 w-5" />}
              accent="text-success"
            />
            <StatCard
              label="Reservations"
              value={formatNumber(stats.total_reservations)}
              icon={<MonitorPlay className="h-5 w-5" />}
              accent="text-primary"
            />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Reservation progress
              </CardTitle>
              <CardDescription>
                {stats.reserved_percent.toFixed(1)}% of tickets are reserved
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Progress value={stats.reserved_percent} />
              <div className="mt-2 text-xs text-muted-foreground">
                {formatNumber(stats.reserved_tickets)} of{" "}
                {formatNumber(stats.total_tickets)} tickets reserved
              </div>
            </CardContent>
          </Card>
        </>
      )}
<Card>
        <CardHeader>
          <CardTitle>Recent reservations</CardTitle>
          <CardDescription>Latest activity across the raffle</CardDescription>
        </CardHeader>
        <CardContent>
          {!stats ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : stats.recent_reservations.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No reservations yet.{" "}
              <Link
                className="text-primary underline-offset-4 hover:underline"
                to="/reservations/new"
              >
                Reserve the first tickets
              </Link>
            </p>
          ) : (
            <ul className="divide-y">
              {stats.recent_reservations.map((reservation) => (
                <li
                  key={reservation.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div>
                    <div className="font-medium">{reservation.customer_name}</div>
                    <div className="text-sm text-muted-foreground">
                      {reservation.ticket_numbers.length > 4
                        ? `${reservation.ticket_numbers[0]} – ${reservation.ticket_numbers.at(-1)}`
                        : reservation.ticket_numbers.join(", ")}{" "}
                      · {formatTime(reservation.reserved_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {reservation.ticket_count} tickets
                    </Badge>
                    <Link
                      to={`/reservations/${reservation.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      View
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => navigate("/monitor")}>
          <MonitorPlay className="h-4 w-4" />
          Open Ticket Monitor
        </Button>
        <Button variant="outline" onClick={() => navigate("/reservations")}>
          <TicketIcon className="h-4 w-4" />
          View Reservations
        </Button>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  accent = "text-foreground",
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className={`rounded-lg bg-muted p-2 ${accent}`}>{icon}</div>
        <div>
          <div className="text-2xl font-bold tabular-nums">{value}</div>
          <div className="text-sm text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i}>
          <CardContent className="flex items-center gap-4 p-5">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <Card className="mx-auto mt-16 max-w-md">
      <CardContent className="space-y-4 p-6 text-center">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button onClick={onAction}>{actionLabel}</Button>
      </CardContent>
    </Card>
  );
}