import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  CalendarDays,
  Phone,
  Printer,
  StickyNote,
  Ticket,
  User,
} from "lucide-react";
import { toast } from "sonner";

import { cancelReservation, fetchReservation } from "@/services/reservations";
import { ApiClientError } from "@/services/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
import { cn, formatDateTime } from "@/lib/utils";
import type { ReservationSummary } from "@/types";

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

/** Label above a value, used for every field in the detail cards. */
function Field({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

/** Big number tile for the money summary strip. */
function Stat({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        emphasis ? "border-primary/30 bg-primary/5" : "bg-card",
      )}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default function ReservationDetails() {
  const { id } = useParams<{ id: string }>();
  const reservationId = Number(id);
  const navigate = useNavigate();
  const [reservation, setReservation] = useState<ReservationSummary | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchReservation(reservationId);
      setReservation(data);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? (err.detail ?? "Reservation not found.")
          : "Unable to connect to the server.",
      );
    }
  }, [reservationId]);

  useEffect(() => {
    if (Number.isFinite(reservationId)) void load();
    else setError("Invalid reservation.");
  }, [load, reservationId]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const updated = await cancelReservation(reservationId);
      setReservation(updated);
      setConfirmCancel(false);
      toast.success(
        `Reservation ${updated.display_id} cancelled. Tickets are available again.`,
      );
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

  /* ------------------------------ Error state ------------------------------ */

  if (error) {
    return (
      <Card className="mx-auto mt-16 max-w-md">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Ticket className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Reservation unavailable</h2>
            <p className="text-sm text-muted-foreground" role="alert">
              {error}
            </p>
          </div>
          <Button onClick={() => navigate("/reservations")}>
            <ArrowLeft className="h-4 w-4" />
            Back to list
          </Button>
        </CardContent>
      </Card>
    );
  }

  /* ----------------------------- Loading state ----------------------------- */

  if (!reservation) {
    return (
      <div
        className="space-y-6"
        aria-busy="true"
        aria-label="Loading reservation"
      >
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  const isActive = reservation.status === "active";

  // Display-only: share of the total already paid (0–100).
  const totalAmount = Number(reservation.total_amount ?? 0);
  const amountPaid = Number(reservation.amount_paid ?? 0);
  const paidPercent =
    Number.isFinite(totalAmount) && totalAmount > 0
      ? Math.min(100, Math.max(0, (amountPaid / totalAmount) * 100))
      : 0;
  const hasBalance = Number(reservation.balance_due) > 0;

  return (
    <div className="space-y-6">
      {/* ------------------------------- Header ------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate("/reservations")}
            aria-label="Back to reservations"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">
                {reservation.display_id}
              </h1>
              <Badge variant={isActive ? "success" : "secondary"}>
                {isActive ? "Active" : "Cancelled"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">Reservation details</p>
          </div>
        </div>

        {isActive && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => navigate(`/print/${reservation.id}`)}
            >
              <Printer className="h-4 w-4" />
              Print Tickets
            </Button>
            <Button
              variant="destructive"
              onClick={() => setConfirmCancel(true)}
            >
              <Ban className="h-4 w-4" />
              Cancel Reservation
            </Button>
          </div>
        )}
      </div>

      {/* Cancelled notice */}
      {!isActive && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <Ban className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">This reservation was cancelled.</p>
            <p className="text-muted-foreground">
              {reservation.cancelled_at
                ? `Cancelled on ${formatDateTime(reservation.cancelled_at)}. `
                : ""}
              Its tickets are available again.
            </p>
          </div>
        </div>
      )}

      {/* ---------------------------- Money summary ---------------------------- */}
      <section aria-label="Payment summary" className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Total amount"
            value={formatPeso(reservation.total_amount)}
          />
          <Stat
            label="Amount paid"
            value={formatPeso(reservation.amount_paid)}
          />
          <Stat
            label="Balance due"
            value={formatPeso(reservation.balance_due)}
            emphasis={hasBalance && isActive}
          />
        </div>
        <div className="space-y-1.5">
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
          <p className="text-xs text-muted-foreground tabular-nums">
            {Math.round(paidPercent)}% paid
          </p>
        </div>
      </section>

      {/* ------------------------------ Detail cards ------------------------------ */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4 text-muted-foreground" />
              Customer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4">
              <Field label="Name">{reservation.customer_name}</Field>
              <Field label="Contact" icon={<Phone className="h-3 w-3" />}>
                {reservation.contact_number || "—"}
              </Field>
              {reservation.notes && (
                <Field label="Notes" icon={<StickyNote className="h-3 w-3" />}>
                  <span className="font-normal">{reservation.notes}</span>
                </Field>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              Reservation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4">
              <Field label="Reserved at">
                {formatDateTime(reservation.reserved_at)}
              </Field>
              <Field label="Total tickets">{reservation.ticket_count}</Field>
              {reservation.cancelled_at && (
                <Field label="Cancelled at">
                  {formatDateTime(reservation.cancelled_at)}
                </Field>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Payment</CardTitle>
            <Badge
              variant={
                reservation.payment_status === "paid"
                  ? "success"
                  : reservation.payment_status === "partially_paid"
                    ? "warning"
                    : "secondary"
              }
              className="capitalize"
            >
              {reservation.payment_status.replace(/_/g, " ")}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Price per ticket</dt>
                <dd className="font-medium tabular-nums">
                  {formatPeso(reservation.price_per_ticket)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Total amount</dt>
                <dd className="font-medium tabular-nums">
                  {formatPeso(reservation.total_amount)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Amount paid</dt>
                <dd className="font-medium tabular-nums">
                  {formatPeso(reservation.amount_paid)}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-t pt-2">
                <dt className="font-medium">Balance due</dt>
                <dd className="font-semibold tabular-nums">
                  {formatPeso(reservation.balance_due)}
                </dd>
              </div>
            </dl>
            {reservation.payment_notes && (
              <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Notes: </span>
                {reservation.payment_notes}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* -------------------------------- Tickets -------------------------------- */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Ticket className="h-4 w-4 text-muted-foreground" />
              Tickets
            </CardTitle>
            <CardDescription>
              Ticket numbers on this reservation
            </CardDescription>
          </div>
          <Badge variant="secondary" className="tabular-nums">
            {reservation.ticket_count}
          </Badge>
        </CardHeader>
        <CardContent>
          <ul
            className={cn(
              "grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12",
              !isActive && "opacity-60",
            )}
          >
            {reservation.ticket_numbers.map((number) => (
              <li
                key={number}
                className={cn(
                  "rounded-md border bg-muted/40 px-1 py-2 text-center text-sm font-semibold tabular-nums",
                  !isActive && "line-through",
                )}
              >
                {number}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div>
        <Button asChild variant="link" className="px-0">
          <Link to="/reservations">
            <ArrowLeft className="h-4 w-4" />
            Return to reservation list
          </Link>
        </Button>
      </div>

      {/* ------------------------------ Cancel dialog ------------------------------ */}
      <AlertDialog
        open={confirmCancel}
        onOpenChange={(open) => {
          if (!open && cancelling) return;
          setConfirmCancel(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this reservation?</AlertDialogTitle>
            <AlertDialogDescription>
              {reservation.display_id} for {reservation.customer_name} (
              {reservation.ticket_count} ticket
              {reservation.ticket_count === 1 ? "" : "s"}). The ticket numbers
              will become available again immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel disabled={cancelling}>
              Keep reservation
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Keep the dialog open until the request finishes.
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
