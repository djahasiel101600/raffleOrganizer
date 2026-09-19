import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MoreHorizontal, Printer, Search } from "lucide-react";
import { toast } from "sonner";

import {
  cancelReservation,
  fetchReservations,
} from "@/services/reservations";
import { useReservationSocket } from "@/services/websocket";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
import { formatDateTime } from "@/lib/utils";
import type { ReservationSummary } from "@/types";

const PAGE_SIZE = 20;

export default function Reservations() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ReservationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<ReservationSummary | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const { subscribe } = useReservationSocket();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchReservations({
        search: search.trim() || undefined,
        status:
          statusFilter === "all" ? undefined : (statusFilter as "active" | "cancelled"),
        page,
      });
      setItems(data.results);
      setTotal(data.count);
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.detail ?? "Unable to load reservations."
          : "Unable to connect to the server."
      );
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const unsubscribe = subscribe(() => {
      void load();
    });
    return unsubscribe;
  }, [subscribe, load]);

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await cancelReservation(cancelTarget.id);
      toast.success(
        `Reservation ${cancelTarget.display_id} cancelled. Tickets are available again.`
      );
      setCancelTarget(null);
      void load();
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reservations</h1>
          <p className="text-sm text-muted-foreground">
            Search, review, print, and cancel reservations
          </p>
        </div>
        <Button onClick={() => navigate("/reservations/new")}>
          New Reservation
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>All reservations</CardTitle>
          <CardDescription>
            {total} reservation{total === 1 ? "" : "s"} found
          </CardDescription>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search by customer name, contact, or ticket number…"
                className="pl-9"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No reservations found.
              <br />
              Reservations will appear here after tickets are reserved.
            </p>
          ) : (
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reservation</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Tickets</TableHead>
                    <TableHead>Ticket Numbers</TableHead>
                    <TableHead>Reserved At</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((reservation) => (
                    <TableRow
                      key={reservation.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/reservations/${reservation.id}`)}
                    >
                      <TableCell className="font-medium">
                        {reservation.display_id}
                      </TableCell>
                      <TableCell>{reservation.customer_name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {reservation.contact_number || "—"}
                      </TableCell>
                      <TableCell>{reservation.ticket_count}</TableCell>
                      <TableCell className="max-w-52 truncate text-muted-foreground">
                        {reservation.ticket_numbers.join(", ")}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(reservation.reserved_at)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            reservation.status === "active" ? "success" : "secondary"
                          }
                        >
                          {reservation.status === "active" ? "Active" : "Cancelled"}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className="text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => navigate(`/reservations/${reservation.id}`)}
                            >
                              View details
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => navigate(`/print/${reservation.id}`)}
                              disabled={reservation.status !== "active"}
                            >
                              <Printer className="h-4 w-4" />
                              Print tickets
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setCancelTarget(reservation)}
                              disabled={reservation.status !== "active"}
                            >
                              Cancel reservation
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

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

      <AlertDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
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