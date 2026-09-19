import { useCallback, useEffect, useRef, useState } from "react";
import { MonitorPlay } from "lucide-react";

import { fetchMonitor } from "@/services/dashboard";
import { useReservationSocket } from "@/services/websocket";
import { ConnectionIndicator } from "@/components/ConnectionIndicator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, formatTime } from "@/lib/utils";
import type { MonitorData, MonitorRecentReservation } from "@/types";

export default function TicketMonitor() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [error, setError] = useState(false);
  const { status, subscribe } = useReservationSocket();

  // Keep a local list of recent activity so new events appear instantly,
  // then reconcile with the server snapshot.
  const [activity, setActivity] = useState<MonitorRecentReservation[]>([]);
  const dataRef = useRef<MonitorData | null>(null);

  const applySnapshot = useCallback((snapshot: MonitorData) => {
    setData(snapshot);
    setActivity((prev) =>
      prev.length > 0
        ? mergeActivity(snapshot.recent_reservations, prev)
        : snapshot.recent_reservations
    );
  }, []);

  const load = useCallback(async () => {
    try {
      const snapshot = await fetchMonitor();
      dataRef.current = snapshot;
      applySnapshot(snapshot);
      setError(false);
    } catch {
      setError(true);
    }
  }, [applySnapshot]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const unsubscribe = subscribe((event) => {
      if (event.type === "reservation_created") {
        const candidate: MonitorRecentReservation = {
          id: event.reservation_id,
          display_id: event.reservation_display_id,
          customer_name: event.customer_name ?? "Unknown",
          ticket_numbers: event.ticket_numbers,
          ticket_count: event.ticket_numbers.length,
          reserved_at: event.reserved_at ?? new Date().toISOString(),
        };
        const current = dataRef.current;
        if (current) {
          const nextReserved = current.reserved_tickets + candidate.ticket_count;
          const next: MonitorData = {
            ...current,
            reserved_tickets: nextReserved,
            available_tickets: Math.max(0, current.available_tickets - candidate.ticket_count),
            reserved_percent:
              current.total_tickets > 0
                ? Math.round((nextReserved / current.total_tickets) * 10) / 10
                : 0,
            total_reservations: current.total_reservations + 1,
          };
          dataRef.current = next;
          setData(next);
        }
        setActivity((prev) => [candidate, ...prev].slice(0, 30));
      } else if (event.type === "reservation_cancelled") {
        const current = dataRef.current;
        if (current) {
          const nextReserved = Math.max(
            0,
            current.reserved_tickets - event.ticket_numbers.length
          );
          const next: MonitorData = {
            ...current,
            reserved_tickets: nextReserved,
            available_tickets: Math.min(
              current.total_tickets,
              current.available_tickets + event.ticket_numbers.length
            ),
            reserved_percent:
              current.total_tickets > 0
                ? Math.round((nextReserved / current.total_tickets) * 10) / 10
                : 0,
            total_reservations: Math.max(0, current.total_reservations - 1),
          };
          dataRef.current = next;
          setData(next);
        }
        setActivity((prev) => prev.filter((r) => r.id !== event.reservation_id));
        // Re-fetch to stay consistent after a cancel/re-use cycle.
        void load();
      }
    });
    return unsubscribe;
  }, [subscribe, load]);

  return (
    <div className="no-print flex min-h-screen flex-col bg-slate-950 p-4 text-white md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <MonitorPlay className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-xl font-bold tracking-tight md:text-2xl">
              RAFFLE TICKET RESERVATION MONITOR
            </h1>
            <p className="text-sm text-slate-400">
              {data?.raffle_name ?? "Live display"}
            </p>
          </div>
        </div>
        <ConnectionIndicator status={status} />
      </div>

      {error && !data ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="text-2xl font-semibold">Unable to connect</div>
            <p className="mt-2 text-slate-400">
              Reconnecting to the server automatically…
            </p>
          </div>
        </div>
      ) : !data ? (
        <div className="mt-10 grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 bg-slate-800" />
          ))}
        </div>
      ) : (
        renderContent(data, activity)
      )}

      <div className="mt-auto pt-6 text-center text-xs text-slate-600">
        {data ? (
          <>
            Total Tickets: {formatNumber(data.total_tickets)} · Reserved:{" "}
            {formatNumber(data.reserved_tickets)} · Available:{" "}
            {formatNumber(data.available_tickets)} · Reservations:{" "}
            {formatNumber(data.total_reservations)}
          </>
        ) : (
          "Waiting for data…"
        )}
      </div>
    </div>
  );
}

function renderContent(data: MonitorData, activity: MonitorRecentReservation[]) {
  const percent = data.reserved_percent;
  return (
    <div className="mt-8 grid flex-1 gap-8 lg:grid-cols-2">
      {/* Statistics */}
      <div className="space-y-8">
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-2xl bg-slate-900 p-5 text-center border border-slate-800">
            <div className="text-3xl font-bold tabular-nums md:text-5xl">
              {formatNumber(data.total_tickets)}
            </div>
            <div className="mt-1 text-sm text-slate-400">Total Tickets</div>
          </div>
          <div className="rounded-2xl bg-amber-950/40 p-5 text-center border border-amber-900/40">
            <div className="text-3xl font-bold tabular-nums text-amber-300 md:text-5xl">
              {formatNumber(data.reserved_tickets)}
            </div>
            <div className="mt-1 text-sm text-amber-200/70">Reserved</div>
          </div>
          <div className="rounded-2xl bg-emerald-950/40 p-5 text-center border border-emerald-900/40">
            <div className="text-3xl font-bold tabular-nums text-emerald-300 md:text-5xl">
              {formatNumber(data.available_tickets)}
            </div>
            <div className="mt-1 text-sm text-emerald-200/70">Available</div>
          </div>
        </div>

        <div className="rounded-2xl bg-slate-900 p-5 border border-slate-800">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-slate-400">Reservation progress</span>
            <span className="font-semibold">{percent.toFixed(1)}%</span>
          </div>
          <div className="h-4 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
            />
          </div>
          <div className="mt-3 text-sm text-slate-400">
            Total Reservations:{" "}
            <span className="font-semibold text-white">
              {formatNumber(data.total_reservations)}
            </span>
          </div>
        </div>
      </div>
{/* Recent activity */}
      <div className="rounded-2xl bg-slate-900 p-5 border border-slate-800">
        <h2 className="mb-4 text-lg font-semibold">RECENT RESERVATIONS</h2>
        {activity.length === 0 ? (
          <p className="py-10 text-center text-slate-500">
            Waiting for the first reservation…
          </p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {activity.map((reservation) => (
              <li key={`${reservation.id}-${reservation.reserved_at}`} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="truncate font-semibold text-lg">
                    {reservation.customer_name}
                  </div>
                  <div className="shrink-0 text-sm text-slate-400">
                    {formatTime(reservation.reserved_at)}
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <span className="truncate text-sm text-slate-300 tabular-nums">
                    {reservation.ticket_numbers.length > 6
                      ? `${reservation.ticket_numbers[0]} – ${reservation.ticket_numbers.at(-1)}`
                      : reservation.ticket_numbers.join(", ")}
                  </span>
                  <span className="shrink-0 rounded-full bg-primary/20 px-2.5 py-0.5 text-xs font-semibold text-white">
                    {reservation.ticket_count} ticket
                    {reservation.ticket_count === 1 ? "" : "s"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function mergeActivity(
  snapshot: MonitorRecentReservation[],
  local: MonitorRecentReservation[]
): MonitorRecentReservation[] {
  const merged = new Map<number, MonitorRecentReservation>();
  [...local, ...snapshot].forEach((r) => merged.set(r.id, r));
  return [...merged.values()].sort(
    (a, b) =>
      new Date(b.reserved_at).getTime() - new Date(a.reserved_at).getTime()
  );
}