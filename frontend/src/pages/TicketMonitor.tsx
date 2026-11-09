import { useCallback, useEffect, useRef, useState } from "react";
import { MonitorPlay, Radio, Ticket, Users } from "lucide-react";

import { fetchMonitor } from "@/services/dashboard";
import { useReservationSocket } from "@/services/websocket";
import { ConnectionIndicator } from "@/components/ConnectionIndicator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatNumber, formatTime } from "@/lib/utils";
import type { MonitorData, MonitorRecentReservation } from "@/types";

/**
 * Set to true when streaming publicly to show only "Juan D." instead of the
 * full customer name. Display-only: data is never altered.
 */
const MASK_CUSTOMER_NAMES = false;

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

function maskName(name: string): string {
  if (!MASK_CUSTOMER_NAMES) return name;
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? name;
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}

/** Compacts ticket numbers into accurate ranges, e.g. "1–3, 7, 9–10". */
function formatTicketNumbers(values: Array<number | string>): string {
  if (values.length === 0) return "—";
  const nums = values.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return values.join(", ");
  const sorted = [...nums].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i += 1) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    parts.push(start === prev ? String(start) : start + "–" + prev);
    start = current;
    prev = current;
  }
  return parts.join(", ");
}

/** Tweens between numbers so changes are easy to notice on a live stream. */
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    const duration = 700;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (value - from) * eased);
      fromRef.current = next;
      setDisplay(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{formatNumber(display)}</>;
}

/** Local wall-clock for the header (handy for viewers of a live stream). */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/* -------------------------------------------------------------------------- */
/*                                 Component                                  */
/* -------------------------------------------------------------------------- */

export default function TicketMonitor() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [error, setError] = useState(false);
  const { status, subscribe } = useReservationSocket();
  const now = useClock();

  // Keep a local list of recent activity so new events appear instantly,
  // then reconcile with the server snapshot.
  const [activity, setActivity] = useState<MonitorRecentReservation[]>([]);
  const dataRef = useRef<MonitorData | null>(null);

  const applySnapshot = useCallback((snapshot: MonitorData) => {
    setData(snapshot);
    setActivity((prev) =>
      prev.length > 0
        ? mergeActivity(snapshot.recent_reservations, prev)
        : snapshot.recent_reservations,
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
          const nextReserved =
            current.reserved_tickets + candidate.ticket_count;
          const next: MonitorData = {
            ...current,
            reserved_tickets: nextReserved,
            available_tickets: Math.max(
              0,
              current.available_tickets - candidate.ticket_count,
            ),
            reserved_percent:
              current.total_tickets > 0
                ? Math.round((nextReserved / current.total_tickets) * 1000) / 10
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
            current.reserved_tickets - event.ticket_numbers.length,
          );
          const next: MonitorData = {
            ...current,
            reserved_tickets: nextReserved,
            available_tickets: Math.min(
              current.total_tickets,
              current.available_tickets + event.ticket_numbers.length,
            ),
            reserved_percent:
              current.total_tickets > 0
                ? Math.round((nextReserved / current.total_tickets) * 1000) / 10
                : 0,
            total_reservations: Math.max(0, current.total_reservations - 1),
          };
          dataRef.current = next;
          setData(next);
        }
        setActivity((prev) =>
          prev.filter((r) => r.id !== event.reservation_id),
        );
        // Re-fetch to stay consistent after a cancel/re-use cycle.
        void load();
      }
    });
    return unsubscribe;
  }, [subscribe, load]);

  return (
    <div className="no-print relative flex h-screen flex-col overflow-hidden bg-slate-950 text-white">
      {/* Ambient background glow (purely decorative) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.12),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(245,158,11,0.10),transparent_50%)]"
      />

      {/* Content sits inside a safe margin so nothing is cropped by streams */}
      <div className="relative flex min-h-0 flex-1 flex-col gap-5 p-5 md:gap-6 md:p-8 lg:px-12 lg:py-8">
        {/* ------------------------------ Header ------------------------------ */}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/30">
              <MonitorPlay className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold uppercase tracking-[0.12em] md:text-2xl">
                Raffle Ticket Reservation Monitor
              </h1>
              <p className="text-sm text-slate-400 md:text-base">
                {data?.raffle_name ?? "Live display"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden text-right sm:block">
              <div className="text-xl font-semibold tabular-nums md:text-2xl">
                {now.toLocaleTimeString("en-PH", {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
              <div className="text-xs text-slate-400">
                {now.toLocaleDateString("en-PH", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </div>
            </div>
            <ConnectionIndicator status={status} />
          </div>
        </header>

        {/* ------------------------------- Body ------------------------------- */}
        {error && !data ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 h-3 w-3 animate-pulse rounded-full bg-amber-400" />
              <div className="text-3xl font-semibold">Unable to connect</div>
              <p className="mt-2 text-slate-400">
                Reconnecting to the server automatically…
              </p>
            </div>
          </div>
        ) : !data ? (
          <div className="grid flex-1 gap-6 lg:grid-cols-5">
            <Skeleton className="h-full min-h-64 bg-slate-800 lg:col-span-3" />
            <Skeleton className="h-full min-h-64 bg-slate-800 lg:col-span-2" />
          </div>
        ) : (
          <MonitorContent data={data} activity={activity} />
        )}

        {/* ------------------------------ Footer ------------------------------ */}
        <footer className="text-center text-xs text-slate-500">
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
        </footer>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                               Main dashboard                               */
/* -------------------------------------------------------------------------- */

function MonitorContent({
  data,
  activity,
}: {
  data: MonitorData;
  activity: MonitorRecentReservation[];
}) {
  const percent = data.reserved_percent;
  const clamped = Math.min(100, Math.max(0, percent));
  const soldOut = data.total_tickets > 0 && data.available_tickets <= 0;
  const latest = activity[0];

  return (
    <div className="grid min-h-0 flex-1 gap-5 md:gap-6 lg:grid-cols-5">
      {/* ------------------------- Left: the big numbers ------------------------- */}
      <section
        aria-label="Ticket statistics"
        className="flex min-h-0 flex-col justify-between gap-6 rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl backdrop-blur md:p-8 lg:col-span-3"
      >
        {/* Hero: available tickets */}
        <div className="text-center">
          <div className="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-300/80 md:text-lg">
            {soldOut ? "Sold out" : "Tickets available"}
          </div>
          <div
            className={cn(
              "mt-2 font-black leading-none tabular-nums",
              "text-[clamp(4.5rem,14vw,13rem)]",
              soldOut
                ? "text-rose-400 drop-shadow-[0_0_40px_rgba(251,113,133,0.35)]"
                : "text-emerald-300 drop-shadow-[0_0_40px_rgba(52,211,153,0.35)]",
            )}
            aria-live="polite"
          >
            <AnimatedNumber value={data.available_tickets} />
          </div>
          <div className="mt-2 text-sm text-slate-400 md:text-lg">
            out of{" "}
            <span className="font-semibold text-slate-200 tabular-nums">
              {formatNumber(data.total_tickets)}
            </span>{" "}
            total tickets
          </div>
        </div>

        {/* Progress */}
        <div>
          <div className="mb-3 flex items-end justify-between">
            <span className="text-sm font-medium uppercase tracking-widest text-slate-400 md:text-base">
              Reservation progress
            </span>
            <span className="text-3xl font-bold tabular-nums md:text-5xl">
              {percent.toFixed(1)}%
            </span>
          </div>
          <div
            className="relative h-6 w-full overflow-hidden rounded-full bg-slate-800 md:h-8"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(clamped)}
            aria-label="Reservation progress"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-primary to-amber-400 transition-all duration-700 ease-out"
              style={{ width: `${clamped}%` }}
            />
            {/* Quarter markers */}
            {[25, 50, 75].map((mark) => (
              <span
                key={mark}
                aria-hidden="true"
                className="absolute top-0 h-full w-px bg-slate-950/60"
                style={{ left: `${mark}%` }}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-slate-500">
            <span>0%</span>
            <span>25%</span>
            <span>50%</span>
            <span>75%</span>
            <span>100%</span>
          </div>
        </div>

        {/* Secondary stats */}
        <div className="grid grid-cols-3 gap-3 md:gap-4">
          <StatTile
            label="Total tickets"
            value={data.total_tickets}
            icon={<Ticket className="h-4 w-4" />}
            tone="slate"
          />
          <StatTile
            label="Reserved"
            value={data.reserved_tickets}
            icon={<Ticket className="h-4 w-4" />}
            tone="amber"
          />
          <StatTile
            label="Reservations"
            value={data.total_reservations}
            icon={<Users className="h-4 w-4" />}
            tone="sky"
          />
        </div>
      </section>

      {/* ------------------------ Right: live activity feed ------------------------ */}
      <section
        aria-label="Recent reservations"
        className="flex min-h-0 flex-col rounded-3xl border border-slate-800 bg-slate-900/70 p-5 shadow-2xl backdrop-blur md:p-6 lg:col-span-2"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold uppercase tracking-[0.2em] md:text-lg">
            Recent reservations
          </h2>
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-rose-400">
            <Radio className="h-4 w-4 animate-pulse" />
            Live
          </span>
        </div>

        {activity.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-500">
            <Ticket className="h-10 w-10 opacity-60" />
            <p className="text-center">Waiting for the first reservation…</p>
          </div>
        ) : (
          <>
            {/* Spotlight: the newest reservation */}
            {latest && (
              <div
                key={`${latest.id}-${latest.reserved_at}`}
                className="mb-4 animate-in fade-in slide-in-from-top-4 rounded-2xl border border-primary/40 bg-primary/10 p-4 duration-500 md:p-5"
              >
                <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-widest text-primary">
                  <span>Latest reservation</span>
                  <span className="text-slate-300 normal-case tracking-normal">
                    {formatTime(latest.reserved_at)}
                  </span>
                </div>
                <div className="mt-2 truncate text-2xl font-bold md:text-4xl">
                  {maskName(latest.customer_name)}
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span
                    className="truncate text-base tabular-nums text-slate-200 md:text-xl"
                    title={formatTicketNumbers(latest.ticket_numbers)}
                  >
                    #{formatTicketNumbers(latest.ticket_numbers)}
                  </span>
                  <span className="shrink-0 rounded-full bg-primary px-3 py-1 text-sm font-bold text-primary-foreground">
                    {latest.ticket_count} ticket
                    {latest.ticket_count === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
            )}

            {/* Scrolling history: clipped (not scrollable) with a soft fade so it
                always fits the screen in a stream capture. */}
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <ul className="divide-y divide-slate-800/80">
                {activity.slice(1).map((reservation) => (
                  <li
                    key={`${reservation.id}-${reservation.reserved_at}`}
                    className="py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="truncate text-base font-semibold md:text-lg">
                        {maskName(reservation.customer_name)}
                      </div>
                      <div className="shrink-0 text-xs text-slate-400 md:text-sm">
                        {formatTime(reservation.reserved_at)}
                      </div>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <span
                        className="truncate text-sm tabular-nums text-slate-300"
                        title={formatTicketNumbers(reservation.ticket_numbers)}
                      >
                        #{formatTicketNumbers(reservation.ticket_numbers)}
                      </span>
                      <span className="shrink-0 rounded-full bg-primary/20 px-2.5 py-0.5 text-xs font-semibold text-white">
                        {reservation.ticket_count} ticket
                        {reservation.ticket_count === 1 ? "" : "s"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-900 to-transparent"
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 Sub-pieces                                 */
/* -------------------------------------------------------------------------- */

const TONES = {
  slate: {
    box: "border-slate-700/80 bg-slate-800/50",
    value: "text-white",
    label: "text-slate-400",
  },
  amber: {
    box: "border-amber-800/50 bg-amber-950/40",
    value: "text-amber-300",
    label: "text-amber-200/70",
  },
  sky: {
    box: "border-sky-800/50 bg-sky-950/40",
    value: "text-sky-300",
    label: "text-sky-200/70",
  },
} as const;

function StatTile({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: keyof typeof TONES;
}) {
  const t = TONES[tone];
  return (
    <div className={cn("rounded-2xl border p-4 text-center md:p-5", t.box)}>
      <div
        className={cn(
          "text-3xl font-bold tabular-nums md:text-5xl lg:text-6xl",
          t.value,
        )}
      >
        <AnimatedNumber value={value} />
      </div>
      <div
        className={cn(
          "mt-1 flex items-center justify-center gap-1.5 text-xs font-medium uppercase tracking-wider md:text-sm",
          t.label,
        )}
      >
        {icon}
        {label}
      </div>
    </div>
  );
}

function mergeActivity(
  snapshot: MonitorRecentReservation[],
  local: MonitorRecentReservation[],
): MonitorRecentReservation[] {
  const merged = new Map<number, MonitorRecentReservation>();
  [...local, ...snapshot].forEach((r) => merged.set(r.id, r));
  return [...merged.values()].sort(
    (a, b) =>
      new Date(b.reserved_at).getTime() - new Date(a.reserved_at).getTime(),
  );
}
