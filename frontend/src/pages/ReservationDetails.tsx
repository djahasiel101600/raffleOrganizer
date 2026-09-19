import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import { toast } from "sonner";

import { cancelReservation, fetchReservation } from "@/services/reservations";
import { ApiClientError } from "@/services/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
import { formatDateTime } from "@/lib/utils";
import type { ReservationSummary } from "@/types";

export default function ReservationDetails() {
  const { id } = useParams<{ id: string }>();
  const reservationId = Number(id);
  const navigate = useNavigate();
  const [reservation, setReservation] = useState<ReservationSummary | null>(null);
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
          ? err.detail ?? "Reservation not found."
          : "Unable to connect to the server."
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
        `Reservation ${updated.display_id} cancelled. Tickets are available again.`
      );
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.detail ?? "Unable to cancel reservation."
          : "Unable to connect to the server."
      );
    } finally {
      setCancelling(false);
    }
  };

  if (error) {
    return (
      <Card className="mx-auto mt-16 max-w-md">
        <CardContent className="space-y-4 p-6 text-center">
          <h2 className="text-lg font-semibold">Reservation unavailable</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={() => navigate("/reservations")}>Back to list</Button>
        </CardContent>
      </Card>
    );
  }

  if (!reservation) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Card>
          <CardContent className="space-y-4 p-6">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const isActive = reservation.status === "active";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/reservations")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {reservation.display_id}
            </h1>
            <p className="text-sm text-muted-foreground">Reservation details</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isActive ? "success" : "secondary"}>
            {isActive ? "Active" : "Cancelled"}
          </Badge>
          {isActive && (
            <>
              <Button
                variant="outline"
                onClick={() => navigate(`/print/${reservation.id}`)}
              >
                <Printer className="h-4 w-4" />
                Print Tickets
              </Button>
              <Button variant="destructive" onClick={() => setConfirmCancel(true)}>
                Cancel Reservation
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Customer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-sm text-muted-foreground">Name</div>
              <div className="font-medium">{reservation.customer_name}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Contact</div>
              <div className="font-medium">{reservation.contact_number || "—"}</div>
            </div>
            {reservation.notes && (
              <div>
                <div className="text-sm text-muted-foreground">Notes</div>
                <div className="text-sm">{reservation.notes}</div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reservation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-sm text-muted-foreground">Reserved At</div>
              <div className="font-medium">
                {formatDateTime(reservation.reserved_at)}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Total Tickets</div>
              <div className="font-medium">{reservation.ticket_count}</div>
            </div>
            {reservation.cancelled_at && (
              <div>
                <div className="text-sm text-muted-foreground">Cancelled At</div>
                <div className="font-medium">
                  {formatDateTime(reservation.cancelled_at)}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Tickets</CardTitle>
            <span className="text-sm text-muted-foreground">
              {reservation.ticket_count}
            </span>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-5 gap-1.5">
              {reservation.ticket_numbers.map((number) => (
                <div
                  key={number}
                  className="rounded border bg-muted/40 px-1 py-1.5 text-center text-xs font-semibold tabular-nums"
                >
                  {number}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <Button asChild variant="link" className="px-0">
          <Link to="/reservations">Return to reservation list</Link>
        </Button>
      </div>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
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
          <AlertDialogFooter>
            <AlertDialogCancel>Keep reservation</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel} disabled={cancelling}>
              {cancelling ? "Cancelling…" : "Cancel reservation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}