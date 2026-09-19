/**
 * Print Center — print reserved tickets by customer or all reserved tickets.
 *
 * The sheet layout is fully configurable (paper, orientation, columns, rows,
 * margin, gap).  Ticket cells are fixed-size: a sheet with 5 columns x 3 rows
 * and only 3 tickets fills exactly the first 3 cells (row-major) and leaves
 * the remaining cells blank.  The single-ticket size guide updates live with
 * every geometry change.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, Printer, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { fetchReservations } from "@/services/reservations";
import { ApiClientError } from "@/services/api";
import { fetchSettings } from "@/services/settings";
import { fetchTicketDesign } from "@/services/ticketDesign";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SizeGuide } from "@/components/print/SizeGuide";
import { TicketCell } from "@/components/print/TicketCell";
import {
  DEFAULT_GEOMETRY,
  MAX_COLUMNS,
  MAX_ROWS,
  cellOriginMm,
  pageRuleCss,
  paginate,
  paperSizeFromApi,
  sheetSizeMm,
  CSS_PX_PER_MM,
  ticketCellSizeMm,
  ticketsPerPage,
  validateGeometry,
} from "@/lib/printLayout";
import type { PrintGeometry } from "@/lib/printLayout";
import { normalizeLayout } from "@/lib/ticketDesign";
import type { TicketDesignPayload, TicketPrintContext } from "@/lib/ticketDesign";
import { formatDate } from "@/lib/utils";
import type { ReservationSummary } from "@/types";

type PrintMode = "customer" | "all";

/** Fetch every active reservation (all pages). */
async function fetchAllActiveReservations(): Promise<ReservationSummary[]> {
  const all: ReservationSummary[] = [];
  const pageSize = 500;
  let page = 1;
  let totalPages = 1;
  do {
    const data = await fetchReservations({
      status: "active",
      page,
      pageSize,
    });
    all.push(...data.results);
    totalPages = Math.max(1, Math.ceil(data.count / pageSize));
    page += 1;
  } while (page <= totalPages);
  return all;
}

/**
 * The tickets of a reservation that may still be printed.
 *
 * Active-only rule: the reservation must be `active`, and each individual
 * ticket must still be reserved.  Falls back to `ticket_numbers` only for
 * older payloads that predate the `printable_ticket_numbers` field.
 */
function printableNumbers(reservation: ReservationSummary): string[] {
  const printable = reservation.printable_ticket_numbers;
  if (Array.isArray(printable)) return printable;
  return reservation.status === "active" ? reservation.ticket_numbers : [];
}

export default function PrintCenter() {
  const [searchParams] = useSearchParams();
  const initialReservationId = Number(searchParams.get("reservation")) || null;

  const [design, setDesign] = useState<TicketDesignPayload | null>(null);
  const [raffleName, setRaffleName] = useState("Community Raffle");
  const [geometry, setGeometry] = useState<PrintGeometry>(DEFAULT_GEOMETRY);

  const [mode, setMode] = useState<PrintMode>("customer");

  // By-customer state.
  const [reservationSearch, setReservationSearch] = useState("");
  const [reservationOptions, setReservationOptions] = useState<
    ReservationSummary[]
  >([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [selectedReservation, setSelectedReservation] =
    useState<ReservationSummary | null>(null);

  // All-tickets state.
  const [allReservations, setAllReservations] = useState<
    ReservationSummary[] | null
  >(null);
  const [allLoading, setAllLoading] = useState(false);

  const [zoom, setZoom] = useState(0.75);
  const [showCellGuides, setShowCellGuides] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const searchTimer = useRef<number | null>(null);

  // ---- initial load: design + raffle settings ----------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [designData, settingsData] = await Promise.all([
          fetchTicketDesign(),
          fetchSettings(),
        ]);
        if (cancelled) return;
        setDesign(designData);
        setGeometry({
          paperSize: paperSizeFromApi(designData.page_size),
          orientation:
            designData.page_orientation === "landscape"
              ? "landscape"
              : "portrait",
          columns: Math.max(1, designData.page_columns),
          rows: Math.max(1, designData.page_rows),
          marginMm: Math.max(0, designData.margin_mm),
          gapMm: Math.max(0, designData.gap_mm),
        });
        if (settingsData.raffle_name) setRaffleName(settingsData.raffle_name);
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof ApiClientError
              ? err.detail ?? "Unable to load the ticket design."
              : "Unable to connect to the server."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- customer options (searchable picker) ------------------------------
  const loadReservationOptions = useCallback(async (search: string) => {
    setOptionsLoading(true);
    try {
      const data = await fetchReservations({
        search: search.trim() || undefined,
        status: "active",
        page: 1,
        pageSize: 25,
      });
      setReservationOptions(data.results);
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.detail ?? "Unable to load reservations."
          : "Unable to connect to the server."
      );
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode !== "customer") return;
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      void loadReservationOptions(reservationSearch);
    }, 250);
    return () => {
      if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    };
  }, [reservationSearch, mode, loadReservationOptions]);

  // ---- preselect the reservation from the query string --------------------
  useEffect(() => {
    if (loading || !initialReservationId) return;
    void (async () => {
      try {
        const data = await fetchReservations({
          page: 1,
          pageSize: 500,
          status: "active",
        });
        const match = data.results.find((r) => r.id === initialReservationId);
        if (match) setSelectedReservation(match);
      } catch {
        // Non-fatal: the picker search can still find it.
      }
    })();
  }, [loading, initialReservationId]);

  // ---- all-tickets mode ----------------------------------------------------
  const loadAllReservations = useCallback(async () => {
    setAllLoading(true);
    try {
      const data = await fetchAllActiveReservations();
      setAllReservations(data);
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.detail ?? "Unable to load reservations."
          : "Unable to connect to the server."
      );
    } finally {
      setAllLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "all" && allReservations === null && !allLoading) {
      void loadAllReservations();
    }
  }, [mode, allReservations, allLoading, loadAllReservations]);

  const updateGeometry = (patch: Partial<PrintGeometry>) =>
    setGeometry((prev) => ({ ...prev, ...patch }));

  // ---- printable tickets ---------------------------------------------------
  const printContexts: TicketPrintContext[] = useMemo(() => {
    const contexts: TicketPrintContext[] = [];
    const addReservation = (reservation: ReservationSummary) => {
      // Active-only: never print a cancelled reservation or a released ticket.
      for (const number of printableNumbers(reservation)) {
        contexts.push({
          number,
          raffle: raffleName,
          customer: reservation.customer_name,
          contact: reservation.contact_number,
          date: formatDate(reservation.reserved_at),
          reservation: reservation.display_id,
        });
      }
    };
    if (mode === "customer") {
      if (selectedReservation) addReservation(selectedReservation);
    } else {
      for (const reservation of allReservations ?? []) addReservation(reservation);
    }
    return contexts;
  }, [mode, selectedReservation, allReservations, raffleName]);

  const geometryError = validateGeometry(geometry);
  const cell = ticketCellSizeMm(geometry);
  const sheet = sheetSizeMm(geometry);
  const pages = useMemo(
    () => paginate(printContexts, ticketsPerPage(geometry)),
    [printContexts, geometry]
  );
  const cellLayout = useMemo(
    () => normalizeLayout(design?.layout ?? []),
    [design]
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loadError) {
    return (
      <Card className="mx-auto mt-16 max-w-md">
        <CardContent className="space-y-4 p-6 text-center">
          <h2 className="text-lg font-semibold">Print Center unavailable</h2>
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  const canPrint = printContexts.length > 0 && geometryError === null;

  return (
    <div>
      {/* Controls (hidden while printing) */}
      <div className="no-print mb-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Print Center</h1>
            <p className="text-sm text-muted-foreground">
              Print reserved tickets — by customer or all reserved tickets
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link to="/designer">Open Ticket Designer</Link>
            </Button>
            <Button onClick={() => window.print()} disabled={!canPrint}>
              <Printer className="h-4 w-4" />
              Print {printContexts.length} ticket
              {printContexts.length === 1 ? "" : "s"}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">What to print</CardTitle>
              <CardDescription>
                {mode === "customer"
                  ? "Print the reserved tickets of one customer."
                  : "Print every ticket reserved across all active reservations."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Label htmlFor="print-mode" className="whitespace-nowrap">
                  Mode
                </Label>
                <Select
                  value={mode}
                  onValueChange={(value) => {
                    setMode(value as PrintMode);
                    if (value === "all" && allReservations === null) {
                      void loadAllReservations();
                    }
                  }}
                >
                  <SelectTrigger id="print-mode" className="w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">By customer</SelectItem>
                    <SelectItem value="all">All reserved tickets</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {mode === "customer" ? (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={reservationSearch}
                      onChange={(event) =>
                        setReservationSearch(event.target.value)
                      }
                      placeholder="Search customer by name or contact…"
                      className="pl-9"
                    />
                  </div>
                  {selectedReservation && (
                    <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                      <span>
                        <span className="font-medium">
                          {selectedReservation.customer_name}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          · {selectedReservation.display_id} ·{" "}
                          {selectedReservation.ticket_count} ticket
                          {selectedReservation.ticket_count === 1 ? "" : "s"}
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedReservation(null)}
                      >
                        Change
                      </Button>
                    </div>
                  )}
                  {!selectedReservation && (
                    <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-1">
                      {optionsLoading ? (
                        <div className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading…
                        </div>
                      ) : reservationOptions.length === 0 ? (
                        <p className="p-4 text-center text-sm text-muted-foreground">
                          No active reservations found.
                        </p>
                      ) : (
                        reservationOptions.map((reservation) => (
                          <button
                            key={reservation.id}
                            type="button"
                            onClick={() => setSelectedReservation(reservation)}
                            className="flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-accent"
                          >
                            <span className="font-medium">
                              {reservation.customer_name}
                            </span>
                            <span className="text-muted-foreground">
                              {reservation.display_id} ·{" "}
                              {reservation.ticket_count} ticket
                              {reservation.ticket_count === 1 ? "" : "s"}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span>
                    {allLoading ? (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading all reserved tickets…
                      </span>
                    ) : (
                      <>
                        {printContexts.length} reserved ticket
                        {printContexts.length === 1 ? "" : "s"} from{" "}
                        {(allReservations ?? []).length} reservation
                        {(allReservations ?? []).length === 1 ? "" : "s"}
                      </>
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void loadAllReservations()}
                    disabled={allLoading}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Sheet setup</CardTitle>
              <CardDescription>
                Columns × rows per sheet — the size guide updates live.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cols">Columns</Label>
                  <Input
                    id="cols"
                    type="number"
                    min={1}
                    max={MAX_COLUMNS}
                    value={geometry.columns}
                    onChange={(event) =>
                      updateGeometry({
                        columns: Math.max(
                          1,
                          Math.min(
                            MAX_COLUMNS,
                            parseInt(event.target.value, 10) || 1
                          )
                        ),
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rows">Rows</Label>
                  <Input
                    id="rows"
                    type="number"
                    min={1}
                    max={MAX_ROWS}
                    value={geometry.rows}
                    onChange={(event) =>
                      updateGeometry({
                        rows: Math.max(
                          1,
                          Math.min(MAX_ROWS, parseInt(event.target.value, 10) || 1)
                        ),
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="paper">Paper</Label>
                  <Select
                    value={geometry.paperSize}
                    onValueChange={(value) =>
                      updateGeometry({
                        paperSize: value as PrintGeometry["paperSize"],
                      })
                    }
                  >
                    <SelectTrigger id="paper">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A4">A4</SelectItem>
                      <SelectItem value="Letter">Letter</SelectItem>
                      <SelectItem value="Legal">Legal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="orientation">Orientation</Label>
                  <Select
                    value={geometry.orientation}
                    onValueChange={(value) =>
                      updateGeometry({
                        orientation: value as PrintGeometry["orientation"],
                      })
                    }
                  >
                    <SelectTrigger id="orientation">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="portrait">Portrait</SelectItem>
                      <SelectItem value="landscape">Landscape</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="margin">Margin (mm)</Label>
                  <Input
                    id="margin"
                    type="number"
                    min={0}
                    max={60}
                    value={geometry.marginMm}
                    onChange={(event) =>
                      updateGeometry({
                        marginMm: Math.max(
                          0,
                          parseInt(event.target.value, 10) || 0
                        ),
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gap">Gap (mm)</Label>
                  <Input
                    id="gap"
                    type="number"
                    min={0}
                    max={50}
                    value={geometry.gapMm}
                    onChange={(event) =>
                      updateGeometry({
                        gapMm: Math.max(0, parseInt(event.target.value, 10) || 0),
                      })
                    }
                  />
                </div>
              </div>
              <SizeGuide geometry={geometry} />
              {geometryError && (
                <p className="text-xs font-medium text-destructive">
                  {geometryError}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="zoom" className="whitespace-nowrap text-sm">
              Zoom
            </Label>
            <Select
              value={String(zoom)}
              onValueChange={(value) => setZoom(Number(value))}
            >
              <SelectTrigger id="zoom" className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[0.5, 0.75, 1].map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {Math.round(value * 100)}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showCellGuides}
              onChange={(event) => setShowCellGuides(event.target.checked)}
              className="h-4 w-4"
            />
            Show empty cell guides (screen only)
          </label>
          <span className="text-sm text-muted-foreground">
            {pages.length} sheet{pages.length === 1 ? "" : "s"} ·{" "}
            {geometry.columns} × {geometry.rows} = {ticketsPerPage(geometry)}{" "}
            per sheet
          </span>
        </div>
      </div>

      {/* Printable sheets (also the on-screen preview) */}
      <div id="print-root" className="space-y-6">
        <style>{pageRuleCss(geometry)}</style>
        {pages.length === 0 && (
          <div className="no-print rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
            Select a customer or switch to “All reserved tickets” to preview
            the tickets.
          </div>
        )}
        {pages.map((pageContexts, pageIndex) => (
          <div
            key={pageIndex}
            className="print-sheet-scaler mx-auto"
            data-page-break={pageIndex < pages.length - 1 ? "always" : "never"}
            style={{
              width: sheet.widthMm * CSS_PX_PER_MM * zoom,
              height: sheet.heightMm * CSS_PX_PER_MM * zoom,
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
            }}
          >
            <div
              className="print-sheet bg-white shadow-md"
              style={{
                width: `${sheet.widthMm}mm`,
                height: `${sheet.heightMm}mm`,
              }}
            >
              {Array.from(
                { length: ticketsPerPage(geometry) },
                (_, cellIndex) => {
                  const origin = cellOriginMm(geometry, cellIndex);
                  const context = pageContexts[cellIndex] ?? null;
                  return (
                    <div
                      key={cellIndex}
                      className="absolute"
                      style={{
                        left: `${origin.xMm}mm`,
                        top: `${origin.yMm}mm`,
                        width: `${cell.widthMm}mm`,
                        height: `${cell.heightMm}mm`,
                      }}
                    >
                      <TicketCell
                        layout={cellLayout}
                        backgroundUrl={design?.background_url ?? null}
                        context={context}
                        widthPx={cell.widthPx}
                        heightPx={cell.heightPx}
                        showBlankOutline={showCellGuides && context === null}
                      />
                    </div>
                  );
                }
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}