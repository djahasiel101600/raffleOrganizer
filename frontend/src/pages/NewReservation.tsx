import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eraser, TicketPlus, X } from "lucide-react";
import { toast } from "sonner";

import { fetchTickets } from "@/services/tickets";
import { createReservation } from "@/services/reservations";
import { useReservationSocket } from "@/services/websocket";
import { TicketGrid } from "@/components/TicketGrid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/text-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiClientError } from "@/services/api";
import type { Ticket } from "@/types";

/** Parse "1, 2, 3, 10-15" style input into a sorted unique number list. */
export function parseTicketInput(input: string): number[] {
  const parts = input.split(/[\s,;]+/).filter(Boolean);
  const numbers = new Set<number>();
  for (const part of parts) {
    const match = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      if (start <= end && end - start <= 5000) {
        for (let n = start; n <= end; n += 1) numbers.add(n);
      }
    } else if (/^\d+$/.test(part)) {
      numbers.add(parseInt(part, 10));
    }
  }
  return [...numbers].sort((a, b) => a - b);
}


export default function NewReservation() {
  const navigate = useNavigate();
  const [customerName, setCustomerName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [ticketSearch, setTicketSearch] = useState("");
  const [directInput, setDirectInput] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [totalTickets, setTotalTickets] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const searchTimer = useRef<number | null>(null);
  const { subscribe } = useReservationSocket();

  const loadTickets = useCallback(
    async (search: string, pageNum: number, refresh = false) => {
      setLoading(true);
      try {
        const data = await fetchTickets({ search, page: pageNum, page_size: 100 });
        setTickets(data.results);
        setTotalTickets(data.count);
        if (refresh) setPage(1);
        setLoadError(null);
      } catch (err) {
        setLoadError(
          err instanceof ApiClientError
            ? err.detail ?? "Unable to load tickets."
            : "Unable to connect to the server."
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadTickets("", 1, true);
  }, [loadTickets]);

  useEffect(() => {
    // Keep the grid fresh when tickets are reserved elsewhere.
    const unsubscribe = subscribe(() => {
      void loadTickets(ticketSearch, page, false);
    });
    return unsubscribe;
  }, [subscribe, loadTickets, ticketSearch, page]);

  const handleSearchChange = (search: string) => {
    setTicketSearch(search);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      void loadTickets(search.trim(), 1, true);
    }, 300);
  };

  const toggleTicket = (displayNumber: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(displayNumber)) next.delete(displayNumber);
      else next.add(displayNumber);
      return next;
    });
  };

  const removeTicket = (displayNumber: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(displayNumber);
      return next;
    });
  };

  const clearSelection = () => {
    setSelected(new Set());
    setDirectInput("");
  };

  const addDirectNumbers = () => {
    const numbers = parseTicketInput(directInput);
    if (numbers.length === 0) {
      toast.error("Enter a valid ticket list, e.g. 1, 2, 3, 10-15");
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      numbers.forEach((n) => next.add(String(n)));
      return next;
    });
    toast.success(`${numbers.length} ticket(s) added to the selection.`);
  };

  // Ordered numeric list of the selection used for submission. Derived from
  // `selected` so it can never be stale when "Reserve Tickets" is clicked.
  const selectedNumbers = useMemo(
    () => [...selected].map((s) => parseInt(s, 10)).sort((a, b) => a - b),
    [selected]
  );

  const handleSubmit = async () => {
    const name = customerName.trim();
    if (!name) {
      toast.error("Customer name is required.");
      return;
    }
    if (selectedNumbers.length === 0) {
      toast.error("Select at least one ticket number.");
      return;
    }
    setSubmitting(true);
    try {
      const reservation = await createReservation({
        customer_name: name,
        contact_number: contactNumber.trim(),
        notes: notes.trim(),
        ticket_numbers: selectedNumbers,
      });
      toast.success(
        `Reservation successful. ${reservation.ticket_count} tickets reserved for ${reservation.customer_name}.`,
        { duration: 6000 }
      );
      navigate(`/print/${reservation.id}`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error(err.detail ?? "Unable to reserve tickets.");
      } else {
        toast.error("Unable to connect to the server. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalTickets / 100));
  const selectionList = [...selectedNumbers].sort((a, b) => a - b);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Reservation</h1>
          <p className="text-sm text-muted-foreground">
            Enter the customer and select their ticket numbers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-sm">
            <TicketPlus className="mr-1 h-3.5 w-3.5" />
            {selectedNumbers.length} selected
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={clearSelection}
            disabled={selectedNumbers.length === 0}
          >
            <Eraser className="h-4 w-4" />
            Clear
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Customer information */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Customer</CardTitle>
            <CardDescription>Who are the tickets for?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="customer_name">Customer Name *</Label>
              <Input
                id="customer_name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Juan Dela Cruz"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact_number">Contact Number</Label>
              <Input
                id="contact_number"
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
                placeholder="09123456789"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes"
                rows={4}
              />
            </div>
          </CardContent>
        </Card>
{/* Ticket selection */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Select Tickets</CardTitle>
            <CardDescription>
              Click tickets in the grid or enter numbers directly (e.g. 1, 2,
              10-15)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={ticketSearch}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search ticket number…"
                className="sm:max-w-xs"
              />
              <div className="flex flex-1 gap-2">
                <Input
                  value={directInput}
                  onChange={(e) => setDirectInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addDirectNumbers();
                    }
                  }}
                  placeholder="1, 2, 3, 10-15"
                />
                <Button type="button" variant="secondary" onClick={addDirectNumbers}>
                  Add
                </Button>
              </div>
            </div>

            {loadError ? (
              <div className="flex flex-col items-center gap-2 py-8">
                <p className="text-sm font-medium text-destructive">{loadError}</p>
                <p className="text-xs text-muted-foreground">
                  Check that the backend server is running, then try again.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadTickets(ticketSearch, page, true)}
                >
                  Retry
                </Button>
              </div>
            ) : loading ? (
              <div className="grid grid-cols-5 gap-2">
                {Array.from({ length: 15 }).map((_, i) => (
                  <Skeleton key={i} className="h-11 rounded-md" />
                ))}
              </div>
            ) : tickets.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {ticketSearch.trim()
                  ? "No tickets match your search."
                  : "No tickets have been configured yet. Set the ticket range in Settings."}
              </p>
            ) : (
              <TicketGrid
                tickets={tickets}
                selected={selected}
                onToggle={toggleTicket}
                disabled={submitting}
              />
            )}

            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => {
                    const next = Math.max(1, page - 1);
                    setPage(next);
                    void loadTickets(ticketSearch, next, false);
                  }}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => {
                    const next = Math.min(totalPages, page + 1);
                    setPage(next);
                    void loadTickets(ticketSearch, next, false);
                  }}
                >
                  Next
                </Button>
              </div>
            )}

            {/* Selected list */}
            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">Selected</span>
                <span className="text-sm text-muted-foreground">
                  Total: {selectionList.length} ticket
                  {selectionList.length === 1 ? "" : "s"}
                </span>
              </div>
              {selectionList.length === 0 ? (
                <p className="py-3 text-center text-sm text-muted-foreground">
                  No tickets selected yet.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {selectionList.map((number) => (
                    <Badge
                      key={number}
                      variant="secondary"
                      className="gap-1 py-1 pr-1 pl-2 text-xs"
                    >
                      {String(number).padStart(4, "0")}
                      <button
                        type="button"
                        onClick={() => removeTicket(String(number))}
                        aria-label={`Remove ticket ${number}`}
                        className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={clearSelection} disabled={submitting}>
                Clear
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="min-w-40"
              >
                {submitting ? "Reserving…" : "Reserve Tickets"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
