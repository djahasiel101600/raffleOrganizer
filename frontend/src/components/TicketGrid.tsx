import { cn } from "@/lib/utils";

interface TicketGridProps {
  tickets: { id: number; display_number: string; status: string }[];
  selected: Set<string>;
  onToggle: (displayNumber: string) => void;
  disabled?: boolean;
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
}: TicketGridProps) {
  return (
    <div className="grid grid-cols-5 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
      {tickets.map((ticket) => {
        const isReserved = ticket.status === "reserved";
        const isSelected = selected.has(ticket.display_number);
        return (
          <button
            key={ticket.id}
            type="button"
            disabled={isReserved || disabled}
            aria-pressed={isSelected}
            title={
              isReserved
                ? `Ticket ${ticket.display_number} — reserved`
                : `Ticket ${ticket.display_number}`
            }
            onClick={() => onToggle(ticket.display_number)}
            className={cn(
              "h-11 rounded-md border text-sm font-semibold tabular-nums transition-colors",
              isReserved &&
                "cursor-not-allowed border-muted bg-muted text-muted-foreground line-through",
              !isReserved &&
                !isSelected &&
                "border-input bg-card hover:border-primary hover:bg-accent cursor-pointer",
              isSelected &&
                "border-primary bg-primary text-primary-foreground cursor-pointer shadow"
            )}
          >
            {ticket.display_number}
          </button>
        );
      })}
    </div>
  );
}