import { Check, Lock } from "lucide-react";

import { cn } from "@/lib/utils";

interface TicketGridProps {
  tickets: { id: number; display_number: string; status: string }[];
  selected: Set<string>;
  onToggle: (displayNumber: string) => void;
  disabled?: boolean;
  /** Show the status legend with counts above the grid (default: true). */
  showLegend?: boolean;
}

/** Diagonal hatching that reads as "unavailable" without relying on colour. */
const RESERVED_PATTERN =
  "repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, currentColor 14%, transparent) 5px 6px)";

function LegendItem({
  swatch,
  label,
  count,
}: {
  swatch: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <li className="flex items-center gap-1.5">
      {swatch}
      <span>{label}</span>
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-foreground">
        {count}
      </span>
    </li>
  );
}

/**
 * The speed-oriented ticket selection grid. Available tickets are
 * selectable, selected tickets are highlighted, and reserved tickets are
 * disabled so they can never be picked.
 */
export function TicketGrid({
  tickets,
  selected,
  onToggle,
  disabled = false,
  showLegend = true,
}: TicketGridProps) {
  const reservedCount = tickets.filter((ticket) => ticket.status === "reserved").length;
  const selectedCount = tickets.filter(
    (ticket) => ticket.status !== "reserved" && selected.has(ticket.display_number)
  ).length;
  const availableCount = tickets.length - reservedCount - selectedCount;

  if (tickets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
        No tickets to show.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showLegend && (
        <ul
          aria-label="Ticket status legend"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground"
        >
          <LegendItem
            label="Available"
            count={availableCount}
            swatch={<span className="h-3.5 w-3.5 rounded border border-input bg-card" />}
          />
          <LegendItem
            label="Selected"
            count={selectedCount}
            swatch={
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded border border-primary bg-primary text-primary-foreground">
                <Check className="h-2.5 w-2.5" strokeWidth={3} />
              </span>
            }
          />
          <LegendItem
            label="Reserved"
            count={reservedCount}
            swatch={
              <span
                className="h-3.5 w-3.5 rounded border border-muted bg-muted text-muted-foreground"
                style={{ backgroundImage: RESERVED_PATTERN }}
              />
            }
          />
        </ul>
      )}

      <div
        role="group"
        aria-label="Tickets"
        className="grid grid-cols-5 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10"
      >
        {tickets.map((ticket) => {
          const isReserved = ticket.status === "reserved";
          const isSelected = selected.has(ticket.display_number);
          return (
            <button
              key={ticket.id}
              type="button"
              disabled={isReserved || disabled}
              aria-pressed={isSelected}
              aria-label={
                isReserved
                  ? `Ticket ${ticket.display_number}, reserved`
                  : `Ticket ${ticket.display_number}${isSelected ? ", selected" : ""}`
              }
              title={
                isReserved
                  ? `Ticket ${ticket.display_number} — reserved`
                  : `Ticket ${ticket.display_number}`
              }
              onClick={() => onToggle(ticket.display_number)}
              style={isReserved ? { backgroundImage: RESERVED_PATTERN } : undefined}
              className={cn(
                "relative flex h-11 select-none items-center justify-center rounded-md border text-sm font-semibold tabular-nums",
                "transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isReserved &&
                  "cursor-not-allowed border-muted bg-muted text-muted-foreground/70",
                !isReserved &&
                  !isSelected &&
                  "cursor-pointer border-input bg-card hover:-translate-y-px hover:border-primary hover:bg-accent hover:shadow-sm active:translate-y-0",
                isSelected &&
                  "cursor-pointer border-primary bg-primary text-primary-foreground shadow-md ring-1 ring-primary/40",
                // A disabled (but not reserved) grid stays readable, just inert.
                disabled && !isReserved && "cursor-not-allowed opacity-60"
              )}
            >
              <span className={cn(isReserved && "line-through decoration-1")}>
                {ticket.display_number}
              </span>

              {isSelected && (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-background bg-primary-foreground text-primary shadow-sm"
                >
                  <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                </span>
              )}
              {isReserved && (
                <Lock
                  aria-hidden="true"
                  className="absolute right-1 top-1 h-2.5 w-2.5 text-muted-foreground/70"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}