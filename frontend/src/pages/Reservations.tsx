import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Ban,
  Banknote,
  Eye,
  FilterX,
  MoreHorizontal,
  Phone,
  Plus,
  Printer,
  Search,
  Ticket,
} from "lucide-react";
import { toast } from "sonner";
import {
  cancelReservation,
  fetchReservations,
  recordPayment,
} from "@/services/reservations";
import { useReservationSocket } from "@/services/websocket";
import { PaymentStatusBadge } from "@/components/PaymentStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pagination } from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiClientError } from "@/services/api";
import { cn, formatDateTime } from "@/lib/utils";
import type { ReservationSummary } from "@/types";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const MAX_PAYMENT_NOTES = 200;

/**
 * Payment methods offered when recording a payment. This is a manual record
 * only - no external payment service is contacted. "Other" lets the user
 * type any custom method.
 */
const PAYMENT_METHODS = ["Cash", "GCash", "Maya", "Bank Transfer", "Other"];
const OTHER_METHOD = "Other";

type FetchParams = NonNullable<Parameters<typeof fetchReservations>[0]>;
type PaymentStatusFilter = FetchParams["payment_status"];
type SourceFilter = FetchParams["source"];
type RecordPaymentPayload = Parameters<typeof recordPayment>[1];

/** Safe peso formatting: never renders "₱NaN" for missing/invalid values. */
function formatPeso(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return (
    "₱" +
    (Number.isFinite(n) ? n : 0).toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** Today's date in the user's local time, as YYYY-MM-DD (for date inputs). */
function todayLocal(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

/**
 * Compacts ticket numbers into accurate ranges, e.g. [1,2,3,7,9,10] becomes
 * "1–3, 7, 9–10". (The old "first – last" display wrongly implied a
 * continuous range when the numbers were not consecutive.)
 */
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

/** Small label/value row used in the payment dialog summary. */
function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{children}</span>
    </div>
  );
}

export default function Reservations() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ReservationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<ReservationSummary | null>(
    null,
  );
  const [cancelling, setCancelling] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<ReservationSummary | null>(
    null,
  );
  const [paymentAmount, setPaymentAmount] = useState("");
  // Selected method from the list ("" = none chosen).
  const [paymentMethod, setPaymentMethod] = useState("");
  // Free text used only when the method is "Other".
  const [customMethod, setCustomMethod] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayLocal());
  const [paymentNotes, setPaymentNotes] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const requestId = useRef(0);
  const { subscribe } = useReservationSocket();

  // Debounce the search box so we don't hit the API on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(search),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  // `silent` refreshes (e.g. from the websocket) keep the table on screen
  // instead of flashing the loading skeleton.
  const load = useCallback(
    async (silent = false) => {
      const id = ++requestId.current;
      if (!silent) setLoading(true);
      try {
        const data = await fetchReservations({
          search: debouncedSearch.trim() || undefined,
          status:
            statusFilter === "all"
              ? undefined
              : (statusFilter as "active" | "cancelled"),
          payment_status:
            paymentStatusFilter === "all"
              ? undefined
              : (paymentStatusFilter as PaymentStatusFilter),
          source:
            sourceFilter === "all" ? undefined : (sourceFilter as SourceFilter),
          page,
          pageSize: PAGE_SIZE,
        });
        // A newer request has started; ignore this stale response.
        if (id !== requestId.current) return;

        // The current page no longer exists (e.g. the last item on the last
        // page was cancelled): move to the last page that does.
        const lastPage = Math.max(1, Math.ceil(data.count / PAGE_SIZE));
        if (page > lastPage) {
          setPage(lastPage);
          return;
        }
        setItems(data.results);
        setTotal(data.count);
      } catch (err) {
        if (id !== requestId.current || silent) return;
        toast.error(
          err instanceof ApiClientError
            ? (err.detail ?? "Unable to load reservations.")
            : "Unable to connect to the server.",
        );
      } finally {
        if (id === requestId.current && !silent) setLoading(false);
      }
    },
    [debouncedSearch, statusFilter, paymentStatusFilter, sourceFilter, page],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const unsubscribe = subscribe(() => {
      void load(true);
    });
    return unsubscribe;
  }, [subscribe, load]);

  // Invalidate any in-flight request on unmount.
  useEffect(() => {
    return () => {
      requestId.current += 1;
    };
  }, []);

  /* ------------------------------ Filters (UI) ----------------------------- */

  const activeFilterCount =
    (search.trim() ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    (paymentStatusFilter !== "all" ? 1 : 0) +
    (sourceFilter !== "all" ? 1 : 0);

  const clearFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setStatusFilter("all");
    setPaymentStatusFilter("all");
    setSourceFilter("all");
    setPage(1);
  };

  /* ---------------------------- Payment dialog ---------------------------- */

  const paymentAmountValue = Number(paymentAmount);
  const paymentBalance = Number(paymentTarget?.balance_due ?? 0);
  const paymentAmountInvalid =
    paymentAmount.trim() === "" ||
    !Number.isFinite(paymentAmountValue) ||
    paymentAmountValue <= 0;
  const paymentExceedsBalance =
    !paymentAmountInvalid && paymentAmountValue > paymentBalance + 0.001;
  const paymentDateInvalid = paymentDate === "" || paymentDate > todayLocal();
  const paymentReady =
    !paymentAmountInvalid && !paymentExceedsBalance && !paymentDateInvalid;
  const balanceAfterPayment = Math.max(
    0,
    paymentBalance - (paymentReady ? paymentAmountValue : 0),
  );
  const resolvedMethod =
    paymentMethod === OTHER_METHOD
      ? customMethod.trim() || OTHER_METHOD
      : paymentMethod || undefined;

  // Display-only: how much of the total has been paid so far (0–100).
  const paidPercent = (() => {
    const totalAmount = Number(paymentTarget?.total_amount ?? 0);
    const paid = Number(paymentTarget?.amount_paid ?? 0);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) return 0;
    return Math.min(100, Math.max(0, (paid / totalAmount) * 100));
  })();

  const resetPaymentForm = () => {
    setPaymentAmount("");
    setPaymentMethod("");
    setCustomMethod("");
    setPaymentReference("");
    setPaymentDate(todayLocal());
    setPaymentNotes("");
  };

  const openPayment = (reservation: ReservationSummary) => {
    // Always start with a clean form so a previous entry never carries over.
    resetPaymentForm();
    setPaymentTarget(reservation);
  };

  const closePayment = () => {
    if (savingPayment) return;
    setPaymentTarget(null);
    resetPaymentForm();
  };

  const handlePayment = async () => {
    if (!paymentTarget || savingPayment) return;
    if (paymentAmountInvalid) {
      toast.error("Enter a payment amount greater than zero.");
      return;
    }
    if (paymentExceedsBalance) {
      toast.error(
        "Payment is more than the balance due (" +
          formatPeso(paymentBalance) +
          ").",
      );
      return;
    }
    if (paymentDateInvalid) {
      toast.error("Choose a payment date that is not in the future.");
      return;
    }
    setSavingPayment(true);
    try {
      const amount = Math.round(paymentAmountValue * 100) / 100;
      // Optional details are only sent when filled in. A payment dated today
      // is sent without `paid_at`, so the server timestamps it itself.
      const payload = {
        amount,
        payment_method: resolvedMethod,
        reference_number: paymentReference.trim() || undefined,
        paid_at: paymentDate !== todayLocal() ? paymentDate : undefined,
        notes: paymentNotes.trim() || undefined,
      };
      await recordPayment(paymentTarget.id, payload as RecordPaymentPayload);
      toast.success(
        "Payment of " +
          formatPeso(amount) +
          " recorded for " +
          paymentTarget.display_id +
          ".",
      );
      setPaymentTarget(null);
      resetPaymentForm();
      void load();
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error(err.detail || "Unable to record payment.");
      } else {
        toast.error("Unable to connect to the server.");
      }
    } finally {
      setSavingPayment(false);
    }
  };

  /* ---------------------------- Cancel dialog ---------------------------- */

  const handleCancel = async () => {
    if (!cancelTarget || cancelling) return;
    setCancelling(true);
    try {
      await cancelReservation(cancelTarget.id);
      toast.success(
        `Reservation ${cancelTarget.display_id} cancelled. Tickets are available again.`,
      );
      setCancelTarget(null);
      void load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? (err.detail ?? "Unable to cancel reservation.")
          : "Unable to connect to the server.",
      );
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ------------------------------ Page header ------------------------------ */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Reservations</h1>
          <p className="text-sm text-muted-foreground">
            Search, review, print, record payments, and cancel reservations
          </p>
        </div>
        <Button onClick={() => navigate("/reservations/new")}>
          <Plus className="h-4 w-4" />
          New Reservation
        </Button>
      </div>

      <Card>
        <CardHeader className="space-y-4 pb-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="space-y-1">
              <CardTitle>All reservations</CardTitle>
              <CardDescription aria-live="polite">
                {loading
                  ? "Loading…"
                  : `${total} reservation${total === 1 ? "" : "s"} found`}
                {activeFilterCount > 0 &&
                  ` · ${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} applied`}
              </CardDescription>
            </div>
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-muted-foreground"
                onClick={clearFilters}
              >
                <FilterX className="h-4 w-4" />
                Clear filters
              </Button>
            )}
          </div>

          {/* Toolbar: search on its own row on mobile, inline on desktop */}
          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search by customer name, contact, or ticket number…"
                aria-label="Search reservations"
                className="pl-9"
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:w-[34rem]">
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-full" aria-label="Filter by status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={paymentStatusFilter}
                onValueChange={(value) => {
                  setPaymentStatusFilter(value);
                  setPage(1);
                }}
              >
                <SelectTrigger
                  className="w-full"
                  aria-label="Filter by payment status"
                >
                  <SelectValue placeholder="Payment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All payments</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="partially_paid">Partially Paid</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={sourceFilter}
                onValueChange={(value) => {
                  setSourceFilter(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-full" aria-label="Filter by source">
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="authenticated">Authenticated</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div
              className="space-y-2"
              aria-busy="true"
              aria-label="Loading reservations"
            >
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Ticket className="h-6 w-6 text-muted-foreground" />
              </div>
              {activeFilterCount > 0 ? (
                <>
                  <div className="space-y-1">
                    <p className="font-medium">No matching reservations</p>
                    <p className="text-sm text-muted-foreground">
                      Try a different search or adjust your filters.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    <FilterX className="h-4 w-4" />
                    Clear filters
                  </Button>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <p className="font-medium">No reservations found</p>
                    <p className="text-sm text-muted-foreground">
                      Reservations will appear here after tickets are reserved.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => navigate("/reservations/new")}
                  >
                    <Plus className="h-4 w-4" />
                    New Reservation
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="whitespace-nowrap">
                        Reservation
                      </TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Tickets</TableHead>
                      <TableHead className="text-right whitespace-nowrap">
                        Total ₱
                      </TableHead>
                      <TableHead className="text-right whitespace-nowrap">
                        Paid ₱
                      </TableHead>
                      <TableHead className="text-right whitespace-nowrap">
                        Balance ₱
                      </TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((reservation) => {
                      const ticketNumbers = formatTicketNumbers(
                        reservation.ticket_numbers ?? [],
                      );
                      const isActive = reservation.status === "active";
                      const balance = Number(reservation.balance_due);
                      const canRecordPayment = isActive && balance > 0;
                      return (
                        <TableRow
                          key={reservation.id}
                          className={cn(
                            "cursor-pointer align-top focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            !isActive && "text-muted-foreground",
                          )}
                          tabIndex={0}
                          onClick={() =>
                            navigate(`/reservations/${reservation.id}`)
                          }
                          onKeyDown={(e) => {
                            // Only react when the row itself has focus, not an inner button.
                            if (
                              e.target === e.currentTarget &&
                              (e.key === "Enter" || e.key === " ")
                            ) {
                              e.preventDefault();
                              navigate(`/reservations/${reservation.id}`);
                            }
                          }}
                        >
                          {/* Reservation ID + timestamp */}
                          <TableCell className="whitespace-nowrap">
                            <div className="font-medium text-foreground">
                              {reservation.display_id}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatDateTime(reservation.reserved_at)}
                            </div>
                          </TableCell>

                          {/* Customer + contact */}
                          <TableCell>
                            <div className="font-medium text-foreground">
                              {reservation.customer_name}
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              {reservation.contact_number ? (
                                <>
                                  <Phone className="h-3 w-3" />
                                  {reservation.contact_number}
                                </>
                              ) : (
                                "—"
                              )}
                            </div>
                          </TableCell>

                          {/* Ticket count + compacted numbers */}
                          <TableCell>
                            <div className="font-medium text-foreground">
                              {reservation.ticket_count}{" "}
                              <span className="font-normal text-muted-foreground">
                                ticket
                                {reservation.ticket_count === 1 ? "" : "s"}
                              </span>
                            </div>
                            <div
                              className="max-w-44 truncate text-xs text-muted-foreground"
                              title={ticketNumbers}
                            >
                              #{ticketNumbers}
                            </div>
                          </TableCell>

                          <TableCell className="text-right tabular-nums whitespace-nowrap">
                            {formatPeso(reservation.total_amount)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">
                            {formatPeso(reservation.amount_paid)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right tabular-nums whitespace-nowrap",
                              canRecordPayment &&
                                "font-semibold text-foreground",
                            )}
                          >
                            {formatPeso(reservation.balance_due)}
                          </TableCell>

                          <TableCell>
                            <PaymentStatusBadge
                              status={reservation.payment_status}
                            />
                          </TableCell>

                          {/* Status + source stacked */}
                          <TableCell>
                            <div className="flex flex-col items-start gap-1">
                              <Badge
                                variant={isActive ? "success" : "secondary"}
                              >
                                {isActive ? "Active" : "Cancelled"}
                              </Badge>
                              <Badge
                                variant={
                                  reservation.source === "public"
                                    ? "default"
                                    : "secondary"
                                }
                                className="text-[10px] capitalize"
                              >
                                {reservation.source}
                              </Badge>
                            </div>
                          </TableCell>

                          {/* Actions */}
                          <TableCell
                            className="text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-1">
                              {canRecordPayment && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 gap-1 px-2"
                                  onClick={() => openPayment(reservation)}
                                  aria-label={`Record payment for ${reservation.display_id}`}
                                >
                                  <Banknote className="h-4 w-4" />
                                  <span className="hidden xl:inline">Pay</span>
                                </Button>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    aria-label={`Actions for ${reservation.display_id}`}
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align="end"
                                  className="w-48"
                                >
                                  <DropdownMenuItem
                                    onClick={() =>
                                      navigate(
                                        `/reservations/${reservation.id}`,
                                      )
                                    }
                                  >
                                    <Eye className="h-4 w-4" />
                                    View details
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => openPayment(reservation)}
                                    disabled={!canRecordPayment}
                                  >
                                    <Banknote className="h-4 w-4" />
                                    Record payment
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      navigate(`/print/${reservation.id}`)
                                    }
                                    disabled={!isActive}
                                  >
                                    <Printer className="h-4 w-4" />
                                    Print tickets
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => setCancelTarget(reservation)}
                                    disabled={!isActive}
                                  >
                                    <Ban className="h-4 w-4" />
                                    Cancel reservation
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                totalItems={total}
                onPageChange={setPage}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment recording dialog (manual record only - no external payment service) */}
      <AlertDialog
        open={Boolean(paymentTarget)}
        onOpenChange={(open) => {
          if (!open) closePayment();
        }}
      >
        <AlertDialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Record Payment</AlertDialogTitle>
            <AlertDialogDescription>
              Reservation {paymentTarget?.display_id} for{" "}
              {paymentTarget?.customer_name} ({paymentTarget?.ticket_count}{" "}
              ticket{paymentTarget?.ticket_count === 1 ? "" : "s"}). This only
              saves a record of a payment you received; no money is processed.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Current standing */}
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">
                Payment status
              </span>
              <Badge
                variant={
                  paymentTarget?.payment_status === "paid"
                    ? "success"
                    : paymentTarget?.payment_status === "partially_paid"
                      ? "warning"
                      : "secondary"
                }
                className="capitalize"
              >
                {paymentTarget?.payment_status?.replace(/_/g, " ")}
              </Badge>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(paidPercent)}
              aria-label="Amount paid so far"
            >
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${paidPercent}%` }}
              />
            </div>
            <SummaryRow label="Total amount">
              {formatPeso(paymentTarget?.total_amount)}
            </SummaryRow>
            <SummaryRow label="Amount already paid">
              {formatPeso(paymentTarget?.amount_paid)}
            </SummaryRow>
            <div className="flex items-center justify-between gap-4 border-t pt-3 text-sm">
              <span className="font-medium">Balance due</span>
              <span className="text-base font-semibold tabular-nums">
                {formatPeso(paymentTarget?.balance_due)}
              </span>
            </div>
          </div>

          {/* Payment form */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-end justify-between gap-2">
                <Label htmlFor="payment_amount">Amount paid</Label>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-xs"
                  onClick={() => setPaymentAmount(paymentBalance.toFixed(2))}
                  disabled={savingPayment || paymentBalance <= 0}
                >
                  Pay full balance ({formatPeso(paymentBalance)})
                </Button>
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                  ₱
                </span>
                <Input
                  id="payment_amount"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handlePayment();
                    }
                  }}
                  aria-invalid={paymentExceedsBalance}
                  aria-describedby={
                    paymentExceedsBalance ? "payment_amount_error" : undefined
                  }
                  placeholder="0.00"
                  className="pl-7 tabular-nums"
                  autoFocus
                />
              </div>
              {paymentExceedsBalance && (
                <p
                  id="payment_amount_error"
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  This is more than the balance due (
                  {formatPeso(paymentBalance)}).
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="payment_method">
                  Payment method{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger id="payment_method" className="w-full">
                    <SelectValue placeholder="Select a method" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((method) => (
                      <SelectItem key={method} value={method}>
                        {method}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="payment_date">Date received</Label>
                <Input
                  id="payment_date"
                  type="date"
                  value={paymentDate}
                  max={todayLocal()}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  aria-invalid={paymentDateInvalid}
                  aria-describedby={
                    paymentDateInvalid ? "payment_date_error" : undefined
                  }
                />
                {paymentDateInvalid && (
                  <p
                    id="payment_date_error"
                    role="alert"
                    className="text-xs font-medium text-destructive"
                  >
                    Choose today or an earlier date.
                  </p>
                )}
              </div>
            </div>

            {paymentMethod === OTHER_METHOD && (
              <Input
                value={customMethod}
                onChange={(e) => setCustomMethod(e.target.value)}
                maxLength={50}
                placeholder="Describe the payment method"
                aria-label="Other payment method"
              />
            )}

            <div className="space-y-1.5">
              <Label htmlFor="payment_reference">
                Reference no.{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                id="payment_reference"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                maxLength={64}
                placeholder="e.g. GCash ref, receipt no."
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="payment_notes">
                  Notes{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {paymentNotes.length}/{MAX_PAYMENT_NOTES}
                </span>
              </div>
              <textarea
                id="payment_notes"
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                maxLength={MAX_PAYMENT_NOTES}
                rows={2}
                placeholder="e.g. Paid in person by the ticket owner"
                className="flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>

            {/* Live preview of the outcome */}
            {paymentReady && (
              <div
                className="space-y-1.5 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm"
                aria-live="polite"
              >
                <SummaryRow label="Balance after this payment">
                  <span className="font-semibold">
                    {formatPeso(balanceAfterPayment)}
                  </span>
                </SummaryRow>
                <SummaryRow label="New status">
                  {balanceAfterPayment <= 0.005
                    ? "Fully paid"
                    : "Partially paid"}
                </SummaryRow>
              </div>
            )}
          </div>

          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel disabled={savingPayment}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Keep the dialog open until the request finishes, so errors
                // don't make the dialog vanish and lose what was typed.
                e.preventDefault();
                void handlePayment();
              }}
              disabled={savingPayment || !paymentReady}
            >
              {savingPayment ? "Saving…" : "Save payment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel reservation dialog */}
      <AlertDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => {
          if (!open && !cancelling) setCancelTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this reservation?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget?.display_id} for {cancelTarget?.customer_name} (
              {cancelTarget?.ticket_count} ticket
              {cancelTarget?.ticket_count === 1 ? "" : "s"}). The ticket numbers
              will become available again immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel disabled={cancelling}>
              Keep reservation
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleCancel();
              }}
              disabled={cancelling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelling ? "Cancelling…" : "Cancel reservation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
