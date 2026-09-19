import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";

import { fetchReservation } from "@/services/reservations";
import { fetchSettings } from "@/services/settings";
import { ApiClientError } from "@/services/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/utils";
import type { ReservationSummary } from "@/types";

const PER_COLUMN_OPTIONS = [1, 2, 3, 4, 5, 6];

export default function PrintPreview() {
  const { id } = useParams<{ id: string }>();
  const reservationId = Number(id);
  const navigate = useNavigate();
  const [reservation, setReservation] = useState<ReservationSummary | null>(null);
  const [raffleName, setRaffleName] = useState("RAFFLE DRAW");
  const [perColumn, setPerColumn] = useState(3);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [reservationData, settingsData] = await Promise.all([
        fetchReservation(reservationId),
        fetchSettings(),
      ]);
      setReservation(reservationData);
      setRaffleName(settingsData.raffle_name || "RAFFLE DRAW");
      setPerColumn(
        PER_COLUMN_OPTIONS.includes(settingsData.default_tickets_per_column)
          ? settingsData.default_tickets_per_column
          : 3
      );
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

  if (error) {
    return (
      <Card className="mx-auto mt-16 max-w-md">
        <CardContent className="space-y-4 p-6 text-center">
          <h2 className="text-lg font-semibold">Print preview unavailable</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={() => navigate(-1)}>Back</Button>
        </CardContent>
      </Card>
    );
  }

  if (!reservation) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      {/* Controls (hidden while printing) */}
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Print Preview</h1>
            <p className="text-sm text-muted-foreground">
              {reservation.display_id} · {reservation.customer_name} ·{" "}
              {reservation.ticket_count} ticket
              {reservation.ticket_count === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="per-column" className="whitespace-nowrap">
              Tickets per column
            </Label>
            <Select
              value={String(perColumn)}
              onValueChange={(value) => setPerColumn(Number(value))}
            >
              <SelectTrigger id="per-column" className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PER_COLUMN_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
          <Button variant="outline" onClick={() => navigate(-1)}>
            Back
          </Button>
        </div>
      </div>

      {/* Printable area */}
      <Card id="print-area" className="mx-auto max-w-3xl p-6">
        <CardHeader className="pb-4 text-center">
          <CardTitle className="text-lg">{raffleName}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {reservation.display_id} · Reserved {formatDateTime(reservation.reserved_at)}
          </p>
        </CardHeader>
        <CardContent>
          <div
            className="grid gap-2"
            style={{
              gridAutoFlow: "column",
              gridTemplateRows: `repeat(${perColumn}, auto)`,
            }}
          >
            {reservation.ticket_numbers.map((number) => (
              <div
                key={number}
                className="print-ticket rounded-md border-2 border-black p-3 text-center"
              >
                <div className="text-[10px] font-semibold uppercase tracking-widest">
                  {raffleName}
                </div>
                <div className="text-[10px] uppercase opacity-70">Ticket</div>
                <div className="my-1 text-3xl font-black tabular-nums tracking-wide">
                  {number}
                </div>
                <div className="text-[10px] opacity-70">Keep this ticket.</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}