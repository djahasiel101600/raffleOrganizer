/**
 * PublicReservation - public, login-free, mobile-first ticket reservation page.
 *
 * Flow:
 *  1. Visitor chooses who the tickets are for (themselves or someone else).
 *  2. Visitor provides the responsible person's full name (mandatory), the
 *     ticket owner's name when reserving for someone else, plus optional
 *     contact number and notes.
 *  3. Visitor selects available ticket numbers (tap the grid or type them),
 *     then taps "Review & Reserve" in the sticky bottom bar.
 *  4. A review sheet summarises the reservation; the visitor confirms it.
 *  5. System shows a confirmation with reference number, total, payment status.
 *
 * No authentication is required at any point.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Keyboard,
  Search,
  Share2,
  TicketPlus,
  User,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { createReservation } from "@/services/reservations";
import { TicketGrid } from "@/components/TicketGrid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { Ticket } from "@/types";

/** Largest range (e.g. 1-5000) accepted in a single typed range. */
const MAX_RANGE_SIZE = 5000;
/** Maximum tickets in one reservation. Adjust to match your backend rule. */
const MAX_TICKETS_PER_RESERVATION = 500;
const PAGE_SIZE = 100;
const MAX_NOTES_LENGTH = 500;
const MAX_NAME_LENGTH = 100;

/**
 * Parses input such as "1, 2, 10-15" or "10 - 15" into a sorted list of
 * unique ticket numbers. Invalid parts are ignored here; use
 * `findInvalidTicketParts` to report them to the user.
 */
export function parseTicketInput(input: string): number[] {
  const normalized = input.replace(/\s*-\s*/g, "-");
  const parts = normalized.split(/[\s,;]+/).filter(Boolean);
  const numbers = new Set<number>();
  for (const part of parts) {
    const match = /^(\d+)-(\d+)$/.exec(part);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      if (start <= end && end - start <= MAX_RANGE_SIZE) {
        for (let n = start; n <= end; n += 1) numbers.add(n);
      }
    } else if (/^\d+$/.test(part)) {
      numbers.add(parseInt(part, 10));
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

/** Returns the parts of the input that parseTicketInput would ignore. */
export function findInvalidTicketParts(input: string): string[] {
  const normalized = input.replace(/\s*-\s*/g, "-");
  const parts = normalized.split(/[\s,;]+/).filter(Boolean);
  const invalid: string[] = [];
  for (const part of parts) {
    const match = /^(\d+)-(\d+)$/.exec(part);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      if (!(start <= end && end - start <= MAX_RANGE_SIZE)) invalid.push(part);
    } else if (!/^\d+$/.test(part)) {
      invalid.push(part);
    }
  }
  return invalid;
}

type ReservationStep = "who" | "name" | "select" | "success";
type BeneficiaryType = "self" | "other";

interface Reservation {
  display_id: string;
  ticket_numbers: Array<number | string>;
  ticket_count: number;
  price_per_ticket: string;
  total_amount: string;
  amount_paid: string;
  payment_status: string;
}

interface TicketsResponse {
  results: Ticket[];
  count: number;
  /** Optional: if the API includes the ticket price, it is shown before submit. */
  ticket_price?: number | string | null;
}

// Public API helpers - anonymous endpoints that skip JWT token attachment
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

class ApiClientError extends Error {
  status: number;
  detail: string;
  code?: string;
  response?: Response;

  constructor(
    status: number,
    detail: string,
    code?: string,
    response?: Response,
  ) {
    super(detail);
    this.name = "ApiClientError";
    this.status = status;
    this.detail = detail;
    this.code = code;
    this.response = response;
  }
}

function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

interface PublicApiFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

async function apiFetchPublic<T>(
  path: string,
  options: PublicApiFetchOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body instanceof FormData) {
    // Let the browser set the multipart boundary header
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(API_BASE + path, {
    method: options.method ?? "GET",
    headers,
    signal: options.signal,
    body:
      options.body instanceof FormData
        ? options.body
        : options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined,
  });

  if (!response.ok) {
    let payload: Record<string, unknown> = {};
    try {
      payload = await response.json();
    } catch {
      // Response had no JSON body; fall back to the generic message below.
    }
    const detail =
      typeof payload.detail === "string"
        ? payload.detail
        : "Request failed (" + response.status + ").";
    const code = typeof payload.code === "string" ? payload.code : undefined;
    throw new ApiClientError(response.status, detail, code, response);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// Lazy import to avoid circular dependency
export async function fetchTicketsPublic(query: {
  search?: string;
  page?: number;
  page_size?: number;
}) {
  const { fetchTickets } = await import("../services/tickets");
  return fetchTickets(query);
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatPeso(amount: number): string {
  return (
    "₱" +
    amount.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function padTicket(value: number | string): string {
  return String(value).padStart(4, "0");
}

function focusField(id: string) {
  document.getElementById(id)?.focus();
}

/* ----------------------------------------------------------------------- */
/* Small presentational helpers                                             */
/* ----------------------------------------------------------------------- */

const STEP_LABELS = ["Who it's for", "Your details", "Pick tickets", "Done"];

function StepIndicator({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <nav
      aria-label={
        "Step " +
        current +
        " of " +
        STEP_LABELS.length +
        ": " +
        STEP_LABELS[current - 1]
      }
      className="w-full"
    >
      <ol className="flex items-center">
        {STEP_LABELS.map((label, index) => {
          const stepNumber = index + 1;
          const done = stepNumber < current;
          const active = stepNumber === current;
          return (
            <li
              key={label}
              className={
                "flex items-center " +
                (index < STEP_LABELS.length - 1 ? "flex-1" : "")
              }
            >
              <div className="flex items-center gap-2">
                <span
                  aria-current={active ? "step" : undefined}
                  className={
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors " +
                    (done || active
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-muted text-muted-foreground")
                  }
                >
                  {done ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    stepNumber
                  )}
                </span>
                <span
                  className={
                    "text-xs font-medium " +
                    (active
                      ? "text-foreground"
                      : "hidden text-muted-foreground sm:inline")
                  }
                >
                  {label}
                </span>
              </div>
              {index < STEP_LABELS.length - 1 && (
                <span
                  aria-hidden="true"
                  className={
                    "mx-2 h-0.5 flex-1 rounded " +
                    (done ? "bg-primary" : "bg-border")
                  }
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SelectedChips({
  list,
  onRemove,
  disabled,
}: {
  list: number[];
  onRemove: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {list.map((number) => {
        const label = padTicket(number);
        return (
          <Badge
            key={number}
            variant="secondary"
            className="gap-1 py-1.5 pr-1 pl-3 text-sm tabular-nums"
          >
            {label}
            <button
              type="button"
              onClick={() => onRemove(number)}
              disabled={disabled}
              aria-label={"Remove ticket " + label}
              className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-muted-foreground/20 active:bg-muted-foreground/30 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </Badge>
        );
      })}
    </div>
  );
}

function BeneficiaryToggle({
  value,
  onChange,
}: {
  value: BeneficiaryType;
  onChange: (next: BeneficiaryType) => void;
}) {
  const options: Array<[BeneficiaryType, string]> = [
    ["self", "For myself"],
    ["other", "For someone else"],
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Who are the tickets for?"
      className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1"
    >
      {options.map(([key, label]) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(key)}
            className={
              "min-h-11 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
              (active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="text-xs font-medium text-destructive">
      {message}
    </p>
  );
}

const SAFE_BOTTOM = {
  paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
} as const;

/* ----------------------------------------------------------------------- */
/* Page                                                                     */
/* ----------------------------------------------------------------------- */

export default function PublicReservation() {
  const [step, setStep] = useState<ReservationStep>("who");
  const [beneficiaryType, setBeneficiaryType] =
    useState<BeneficiaryType | null>(null);
  // The responsible person: makes the reservation and is the payment contact.
  const [customerName, setCustomerName] = useState("");
  // The person who will own the reserved ticket numbers (reserving for others).
  const [ticketOwnerName, setTicketOwnerName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [detailsAttempted, setDetailsAttempted] = useState(false);
  const [ticketSearch, setTicketSearch] = useState("");
  const [directInput, setDirectInput] = useState("");
  const [showTyped, setShowTyped] = useState(false);
  // Selected ticket numbers are always stored as numbers.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [totalTickets, setTotalTickets] = useState(0);
  const [listPrice, setListPrice] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showSelected, setShowSelected] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const searchTimer = useRef<number | null>(null);
  const requestId = useRef(0);
  const gridTopRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [reservation, setReservation] = useState<Reservation | null>(null);

  // Ignores stale responses: only the latest request may update state.
  const loadTickets = useCallback(async (search: string, pageNum: number) => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        search,
        page: String(pageNum),
        page_size: String(PAGE_SIZE),
      });
      const data = await apiFetchPublic<TicketsResponse>(
        "/api/tickets/?" + params.toString(),
        {
          method: "GET",
        },
      );
      if (id !== requestId.current) return;

      setTickets(data.results);
      setTotalTickets(data.count);
      const apiPrice = toNumber(data.ticket_price);
      if (apiPrice !== null) setListPrice(apiPrice);
      setLoadError(null);
    } catch (err) {
      if (id !== requestId.current) return;
      setLoadError(
        isApiClientError(err)
          ? (err.detail ?? "Unable to load tickets.")
          : "Unable to connect to the server.",
      );
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTickets("", 1);
  }, [loadTickets]);

  // Clear any pending search timer and invalidate in-flight requests on unmount.
  useEffect(() => {
    return () => {
      if (searchTimer.current !== null)
        window.clearTimeout(searchTimer.current);
      requestId.current += 1;
    };
  }, []);

  // Start every step at the top of the screen (important on mobile).
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  // Review sheet: lock background scroll, close on Escape, move focus into it.
  useEffect(() => {
    if (!reviewOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sheetRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) setReviewOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [reviewOpen, submitting]);

  const totalPages = Math.ceil(totalTickets / PAGE_SIZE);
  const selectionList = useMemo(
    () => Array.from(selected).sort((a, b) => a - b),
    [selected],
  );
  const selectionCount = selectionList.length;
  const chipsExpanded = showSelected && selectionCount > 0;

  // Who is who. The ticket owner is derived, so nothing is ever duplicated
  // when the visitor goes back and forth between steps.
  const isOther = beneficiaryType === "other";
  const responsibleName = customerName.trim();
  const ownerName = isOther ? ticketOwnerName.trim() : responsibleName;
  const ownerLine = isOther && ownerName ? "Ticket owner: " + ownerName : "";
  // Keep room in the notes limit for the "Ticket owner" line sent to the server.
  const notesLimit = Math.max(
    0,
    MAX_NOTES_LENGTH - (ownerLine ? ownerLine.length + 1 : 0),
  );
  const buildNotes = () =>
    [notes.trim().slice(0, notesLimit), ownerLine].filter(Boolean).join("\n");

  const nameError = detailsAttempted && !responsibleName;
  const ownerError = detailsAttempted && isOther && !ownerName;

  // TicketGrid receives string keys. Both plain ("7") and zero-padded ("0007")
  // forms are included so the grid recognises selections in either format.
  const gridSelected = useMemo(() => {
    const set = new Set<string>();
    for (const n of selected) {
      set.add(String(n));
      set.add(padTicket(n));
    }
    return set;
  }, [selected]);

  const toggleTicket = (value: string) => {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return;
    const next = new Set(selected);
    if (next.has(n)) {
      next.delete(n);
    } else {
      if (next.size >= MAX_TICKETS_PER_RESERVATION) {
        toast.error(
          "You can reserve at most " +
            MAX_TICKETS_PER_RESERVATION +
            " tickets at a time.",
        );
        return;
      }
      next.add(n);
    }
    setSelected(next);
  };

  const addFromDirectInput = () => {
    if (!directInput.trim()) return;
    const numbers = parseTicketInput(directInput);
    const invalid = findInvalidTicketParts(directInput);

    if (invalid.length > 0) {
      toast.error(
        "Ignored invalid entries: " +
          invalid.slice(0, 5).join(", ") +
          (invalid.length > 5 ? "…" : ""),
      );
    }
    if (numbers.length === 0) {
      if (invalid.length === 0)
        toast.error("Please enter ticket numbers, e.g. 1, 2, 10-15.");
      return;
    }

    const next = new Set(selected);
    let added = 0;
    let skipped = 0;
    for (const n of numbers) {
      if (next.has(n)) continue;
      if (next.size >= MAX_TICKETS_PER_RESERVATION) {
        skipped += 1;
        continue;
      }
      next.add(n);
      added += 1;
    }
    if (skipped > 0) {
      toast.error(
        "Limit of " +
          MAX_TICKETS_PER_RESERVATION +
          " tickets reached. " +
          skipped +
          " number(s) were not added.",
      );
    } else if (added > 0) {
      toast.success(
        "Added " + added + " ticket" + (added === 1 ? "" : "s") + ".",
      );
    }
    setSelected(next);
    setDirectInput("");
  };

  const removeTicket = (number: number) => {
    const next = new Set(selected);
    next.delete(number);
    setSelected(next);
  };

  const clearSelection = () => setSelected(new Set());

  const handleSearchChange = (value: string) => {
    setTicketSearch(value);
    setPage(1);
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      void loadTickets(value, 1);
    }, 300);
  };

  const clearSearch = () => {
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    setTicketSearch("");
    setPage(1);
    void loadTickets("", 1);
  };

  const goToPage = (next: number) => {
    setPage(next);
    void loadTickets(ticketSearch, next);
    gridTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const chooseBeneficiary = (type: BeneficiaryType) => {
    setBeneficiaryType(type);
    setDetailsAttempted(false);
    setStep("name");
  };

  const handleNameSubmit = () => {
    setDetailsAttempted(true);
    if (!responsibleName) {
      focusField("customer_name");
      return;
    }
    if (isOther && !ownerName) {
      focusField("ticket_owner_name");
      return;
    }
    setDetailsAttempted(false);
    setStep("select");
  };

  const openReview = () => {
    if (selectionCount === 0) {
      toast.error("Please select at least one ticket.");
      return;
    }
    setReviewOpen(true);
  };

  const handleSubmit = async () => {
    if (selectionList.length === 0) {
      toast.error("Please select at least one ticket.");
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      // Send `undefined` (key omitted) when the price hasn't been loaded yet so
      // the backend falls back to the configured `settings.ticket_price` instead
      // of storing a hard `0` price.
      const created = (await createReservation({
        customer_name: responsibleName,
        contact_number: contactNumber.trim() || undefined,
        notes: buildNotes() || undefined,
        ticket_numbers: selectionList,
        source: "public",
        price_per_ticket: listPrice ?? undefined,
      })) as Reservation;
      setReservation(created);
      setReviewOpen(false);
      setStep("success");
      toast.success(
        "Reservation " + created.display_id + " created successfully!",
      );
      // Refresh so the reserved tickets no longer appear as available.
      void loadTickets(ticketSearch, page);
    } catch (err) {
      if (isApiClientError(err)) {
        toast.error(err.detail || "Unable to create reservation.");
        // 409 = conflict (a ticket was taken by someone else): refresh the grid.
        if (err.status === 409) {
          setReviewOpen(false);
          setSelected(new Set());
          void loadTickets(ticketSearch, page);
        }
      } else {
        toast.error("Unable to connect to the server.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const copyReference = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Reference copied.");
    } catch {
      toast.error("Could not copy. Please copy it manually.");
    }
  };

  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";
  const shareReservation = async (r: Reservation) => {
    try {
      await navigator.share({
        title: "Ticket reservation " + r.display_id,
        text:
          "Reservation " +
          r.display_id +
          " for " +
          ownerName +
          ". Tickets: " +
          (r.ticket_numbers ?? []).map(padTicket).join(", "),
      });
    } catch {
      // The user closed the share sheet; nothing to do.
    }
  };

  const pricePerTicket =
    toNumber(reservation?.price_per_ticket) ??
    (listPrice !== null ? listPrice : NaN);
  const priceKnown =
    toNumber(reservation?.price_per_ticket) !== null || listPrice !== null;
  const estimatedTotal = priceKnown ? selectionCount * pricePerTicket : NaN;
  const totalAmount = toNumber(reservation?.total_amount) ?? estimatedTotal;
  const amountPaid = toNumber(reservation?.amount_paid) ?? 0;
  const balanceDue = totalAmount - amountPaid;

  /* --------------------------------------------------------------------- */
  /* Step: Who the tickets are for                                          */
  /* --------------------------------------------------------------------- */
  if (step === "who") {
    const choices: Array<{
      type: BeneficiaryType;
      title: string;
      hint: string;
      icon: typeof User;
    }> = [
      {
        type: "self",
        title: "For myself",
        hint: "The tickets will be under my name.",
        icon: User,
      },
      {
        type: "other",
        title: "For someone else",
        hint: "I'm reserving for a friend, family member or guest.",
        icon: Users,
      },
    ];
    return (
      <div className="min-h-[100dvh] bg-background px-4 py-6 sm:flex sm:items-center sm:justify-center">
        <div className="mx-auto w-full max-w-md space-y-5">
          <StepIndicator current={1} />
          <Card>
            <CardHeader className="items-center text-center">
              <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <TicketPlus className="h-7 w-7" aria-hidden="true" />
              </div>
              <CardTitle className="text-xl">Reserve Tickets</CardTitle>
              <p className="text-sm text-muted-foreground">
                Who are these tickets for?
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {choices.map(({ type, title, hint, icon: Icon }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => chooseBeneficiary(type)}
                  className="flex min-h-[4.5rem] w-full items-center gap-4 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/60 active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold">
                      {title}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {hint}
                    </span>
                  </span>
                  <ChevronRight
                    className="h-5 w-5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </button>
              ))}
              <p className="pt-1 text-center text-xs text-muted-foreground">
                You can change this on the next screen.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  /* --------------------------------------------------------------------- */
  /* Step: Name entry                                                       */
  /* --------------------------------------------------------------------- */
  if (step === "name") {
    return (
      <div className="min-h-[100dvh] bg-background px-4 py-6 sm:flex sm:items-center sm:justify-center">
        <div className="mx-auto w-full max-w-md space-y-5">
          <StepIndicator current={2} />
          <Card>
            <CardHeader className="space-y-3">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep("who")}
                  className="-ml-2 flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Back
                </button>
                <CardTitle className="text-lg">Your details</CardTitle>
                <span className="w-16" aria-hidden="true" />
              </div>
              <BeneficiaryToggle
                value={isOther ? "other" : "self"}
                onChange={(next) => {
                  setBeneficiaryType(next);
                  setDetailsAttempted(false);
                }}
              />
            </CardHeader>
            <CardContent>
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  handleNameSubmit();
                }}
                className="space-y-5"
              >
                <div className="space-y-2">
                  <Label htmlFor="customer_name">
                    {isOther
                      ? "Your full name (person reserving)"
                      : "Your full name"}
                  </Label>
                  <Input
                    id="customer_name"
                    autoComplete="name"
                    autoCapitalize="words"
                    enterKeyHint="next"
                    maxLength={MAX_NAME_LENGTH}
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    required
                    autoFocus
                    aria-invalid={nameError}
                    aria-describedby={
                      nameError ? "customer_name_error" : "customer_name_hint"
                    }
                    placeholder="e.g. Maria Clara"
                    className={
                      "h-12 text-base " +
                      (nameError ? "border-destructive" : "")
                    }
                  />
                  {nameError ? (
                    <FieldError
                      id="customer_name_error"
                      message="Please enter your full name."
                    />
                  ) : (
                    <p
                      id="customer_name_hint"
                      className="text-xs text-muted-foreground"
                    >
                      {isOther
                        ? "You're the contact person for this reservation and its payment."
                        : "The tickets will be registered under this name."}
                    </p>
                  )}
                </div>

                {isOther && (
                  <div className="space-y-2">
                    <Label htmlFor="ticket_owner_name">
                      Ticket owner&apos;s full name
                    </Label>
                    <Input
                      id="ticket_owner_name"
                      autoComplete="off"
                      autoCapitalize="words"
                      enterKeyHint="next"
                      maxLength={MAX_NAME_LENGTH}
                      value={ticketOwnerName}
                      onChange={(e) => setTicketOwnerName(e.target.value)}
                      required
                      aria-invalid={ownerError}
                      aria-describedby={
                        ownerError
                          ? "ticket_owner_name_error"
                          : "ticket_owner_name_hint"
                      }
                      placeholder="e.g. Juan Dela Cruz"
                      className={
                        "h-12 text-base " +
                        (ownerError ? "border-destructive" : "")
                      }
                    />
                    {ownerError ? (
                      <FieldError
                        id="ticket_owner_name_error"
                        message="Please enter the ticket owner's full name."
                      />
                    ) : (
                      <p
                        id="ticket_owner_name_hint"
                        className="text-xs text-muted-foreground"
                      >
                        The tickets will be registered under this person.
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="contact_number">
                    {isOther ? "Your contact number" : "Contact number"}{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="contact_number"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    enterKeyHint="next"
                    value={contactNumber}
                    onChange={(e) => setContactNumber(e.target.value)}
                    placeholder="e.g. 0917 123 4567"
                    className="h-12 text-base"
                  />
                  <p className="text-xs text-muted-foreground">
                    So the organizer can reach you about payment.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <Label htmlFor="notes">
                      Notes{" "}
                      <span className="font-normal text-muted-foreground">
                        (optional)
                      </span>
                    </Label>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {notes.length}/{notesLimit}
                    </span>
                  </div>
                  <textarea
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    maxLength={notesLimit}
                    placeholder="Anything we should know about this reservation?"
                    className="flex w-full rounded-md border border-input bg-background px-3 py-3 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                </div>

                <Button type="submit" className="h-12 w-full text-base">
                  Continue to Ticket Selection
                  <ChevronRight className="ml-1 h-5 w-5" aria-hidden="true" />
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  /* --------------------------------------------------------------------- */
  /* Step: Ticket selection                                                 */
  /* --------------------------------------------------------------------- */
  if (step === "select") {
    const rangeStart = totalTickets === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
    const rangeEnd = Math.min(page * PAGE_SIZE, totalTickets);

    return (
      <div className="min-h-[100dvh] bg-background">
        <div className="mx-auto w-full max-w-5xl space-y-4 px-4 pt-4 pb-44 sm:pb-40">
          <StepIndicator current={3} />

          <div className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3">
            <div className="min-w-0">
              <h1 className="text-lg font-bold leading-tight tracking-tight">
                Select Your Tickets
              </h1>
              <p className="truncate text-sm text-muted-foreground">
                For{" "}
                <span className="font-medium text-foreground">{ownerName}</span>
                {isOther ? " · reserved by " + responsibleName : ""}
                {contactNumber ? " · " + contactNumber : ""}
              </p>
            </div>
            <Button
              variant="outline"
              className="h-10 shrink-0 px-3"
              onClick={() => setStep("name")}
              disabled={submitting}
            >
              <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
              Edit
              <span className="sr-only"> name and details</span>
            </Button>
          </div>

          {loadError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <span>{loadError}</span>
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => void loadTickets(ticketSearch, page)}
                disabled={loading}
              >
                Retry
              </Button>
            </div>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Available Tickets</CardTitle>
              <CardDescription>
                Tap a number to select it. Reserved tickets cannot be chosen.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Search + optional typed entry (collapsed so the grid stays high on small screens) */}
              <div ref={gridTopRef} className="scroll-mt-4 space-y-2">
                <Label htmlFor="ticket_search" className="sr-only">
                  Search tickets
                </Label>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    id="ticket_search"
                    type="search"
                    inputMode="search"
                    enterKeyHint="search"
                    autoComplete="off"
                    value={ticketSearch}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (searchTimer.current !== null)
                          window.clearTimeout(searchTimer.current);
                        setPage(1);
                        void loadTickets(ticketSearch, 1);
                      }
                    }}
                    placeholder="Search by number…"
                    className="h-11 pl-9 pr-10 text-base"
                  />
                  {ticketSearch && (
                    <button
                      type="button"
                      onClick={clearSearch}
                      aria-label="Clear search"
                      className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setShowTyped((v) => !v)}
                  aria-expanded={showTyped}
                  aria-controls="typed-numbers-panel"
                  className="flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Keyboard className="h-4 w-4" aria-hidden="true" />
                  {showTyped
                    ? "Hide number entry"
                    : "Know your numbers? Type them"}
                  {showTyped ? (
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>

                {showTyped && (
                  <div
                    id="typed-numbers-panel"
                    className="rounded-lg bg-muted/50 p-3"
                  >
                    <Label
                      htmlFor="direct_input"
                      className="text-sm font-medium"
                    >
                      Ticket numbers
                    </Label>
                    <div className="mt-2 flex gap-2">
                      <Input
                        id="direct_input"
                        value={directInput}
                        onChange={(e) => setDirectInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addFromDirectInput();
                          }
                        }}
                        enterKeyHint="done"
                        autoComplete="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        autoFocus
                        placeholder="1, 2, 10-15"
                        className="h-11 flex-1 bg-background text-base"
                      />
                      <Button
                        type="button"
                        onClick={addFromDirectInput}
                        disabled={submitting || !directInput.trim()}
                        className="h-11 px-5"
                      >
                        Add
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Separate with commas, or use a range like{" "}
                      <code className="text-xs">10-15</code>.
                    </p>
                  </div>
                )}

                {!loading && totalTickets > 0 && (
                  <p
                    className="text-xs text-muted-foreground"
                    aria-live="polite"
                  >
                    Showing {rangeStart}–{rangeEnd} of {totalTickets} ticket
                    {totalTickets === 1 ? "" : "s"}
                  </p>
                )}
              </div>

              {/* Grid */}
              {loading ? (
                <div
                  className="space-y-3"
                  aria-busy="true"
                  aria-label="Loading tickets"
                >
                  <Skeleton className="h-48 w-full" />
                </div>
              ) : (
                <>
                  {tickets.length === 0 && !loadError ? (
                    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-10 text-center">
                      <Search
                        className="h-8 w-8 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <div>
                        <p className="font-medium">No tickets found</p>
                        <p className="text-sm text-muted-foreground">
                          Try a different number or clear your search.
                        </p>
                      </div>
                      {ticketSearch && (
                        <Button
                          variant="outline"
                          className="h-10"
                          onClick={clearSearch}
                        >
                          Clear search
                        </Button>
                      )}
                    </div>
                  ) : (
                    <TicketGrid
                      tickets={tickets}
                      selected={gridSelected}
                      onToggle={toggleTicket}
                      disabled={submitting}
                    />
                  )}

                  {totalPages > 1 && (
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <Button
                        variant="outline"
                        className="h-11"
                        disabled={page <= 1 || loading}
                        onClick={() => goToPage(Math.max(1, page - 1))}
                      >
                        <ChevronLeft
                          className="mr-1 h-4 w-4"
                          aria-hidden="true"
                        />
                        Previous
                      </Button>
                      <span className="px-1 text-center text-sm text-muted-foreground">
                        Page {page} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        className="h-11"
                        disabled={page >= totalPages || loading}
                        onClick={() => goToPage(Math.min(totalPages, page + 1))}
                      >
                        Next
                        <ChevronRight
                          className="ml-1 h-4 w-4"
                          aria-hidden="true"
                        />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sticky bottom bar: always-visible selection summary + primary action */}
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur supports-[backdrop-filter]:bg-background/80"
          style={SAFE_BOTTOM}
        >
          <div className="mx-auto w-full max-w-5xl px-4 pt-2">
            {chipsExpanded && (
              <div className="mb-2 max-h-40 overflow-y-auto rounded-lg border bg-muted/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Selected tickets
                  </span>
                  <button
                    type="button"
                    onClick={clearSelection}
                    disabled={submitting}
                    className="min-h-9 px-1 text-xs font-medium text-destructive hover:underline disabled:opacity-50"
                  >
                    Clear all
                  </button>
                </div>
                <SelectedChips
                  list={selectionList}
                  onRemove={removeTicket}
                  disabled={submitting}
                />
              </div>
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowSelected((v) => !v)}
                disabled={selectionCount === 0}
                aria-expanded={chipsExpanded}
                className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left disabled:cursor-default"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    {selectionCount === 0
                      ? "No tickets selected"
                      : selectionCount +
                        " ticket" +
                        (selectionCount === 1 ? "" : "s") +
                        " selected"}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {selectionCount === 0
                      ? "Tap a number above to begin"
                      : priceKnown
                        ? "Estimated total " + formatPeso(estimatedTotal)
                        : "Tap to view or remove"}
                  </div>
                </div>
                {selectionCount > 0 &&
                  (chipsExpanded ? (
                    <ChevronDown
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : (
                    <ChevronUp
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ))}
              </button>
              <Button
                onClick={openReview}
                disabled={submitting || selectionCount === 0}
                className="h-12 shrink-0 px-5 text-base"
              >
                Review &amp; Reserve
              </Button>
            </div>
          </div>
        </div>

        {/* Review & confirm sheet */}
        {reviewOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-title"
          >
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => {
                if (!submitting) setReviewOpen(false);
              }}
              aria-hidden="true"
            />
            <div
              ref={sheetRef}
              tabIndex={-1}
              className="relative max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-background p-5 shadow-xl outline-none sm:max-w-md sm:rounded-2xl"
              style={{
                paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
              }}
            >
              <div
                className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-muted sm:hidden"
                aria-hidden="true"
              />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="review-title" className="text-lg font-bold">
                    Review your reservation
                  </h2>
                  <p className="mb-4 text-sm text-muted-foreground">
                    Please check everything before confirming.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setReviewOpen(false);
                    setStep("name");
                  }}
                  disabled={submitting}
                  className="min-h-11 shrink-0 px-1 text-sm font-medium text-primary hover:underline disabled:opacity-50"
                >
                  Edit details
                </button>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">
                    {isOther ? "Ticket owner" : "Reserved for"}
                  </span>
                  <span className="text-right font-medium">{ownerName}</span>
                </div>
                {isOther && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Reserved by</span>
                    <span className="text-right font-medium">
                      {responsibleName}
                    </span>
                  </div>
                )}
                {contactNumber.trim() && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Contact</span>
                    <span className="text-right font-medium">
                      {contactNumber.trim()}
                    </span>
                  </div>
                )}
                {notes.trim() && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Notes</span>
                    <span className="max-w-[60%] break-words text-right">
                      {notes.trim().slice(0, notesLimit)}
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">Tickets</span>
                  <span className="text-sm text-muted-foreground">
                    {selectionCount} ticket{selectionCount === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="max-h-40 overflow-y-auto">
                  <SelectedChips
                    list={selectionList}
                    onRemove={removeTicket}
                    disabled={submitting}
                  />
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t pt-4">
                <div className="text-sm text-muted-foreground">
                  {priceKnown
                    ? "Estimated total"
                    : "Total shown after reserving"}
                  {priceKnown && (
                    <div className="text-xs">
                      {selectionCount} × {formatPeso(pricePerTicket)}
                    </div>
                  )}
                </div>
                {priceKnown && (
                  <div className="text-xl font-bold tabular-nums">
                    {formatPeso(estimatedTotal)}
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-col gap-2">
                <Button
                  onClick={handleSubmit}
                  disabled={submitting || selectionCount === 0}
                  className="h-12 text-base"
                >
                  {submitting ? "Reserving..." : "Confirm Reservation"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setReviewOpen(false)}
                  disabled={submitting}
                  className="h-12 text-base"
                >
                  Back to edit
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* --------------------------------------------------------------------- */
  /* Step: Success / Confirmation                                           */
  /* --------------------------------------------------------------------- */
  if (step === "success" && reservation) {
    const reservedNumbers = reservation.ticket_numbers ?? [];
    const paymentStatus = reservation.payment_status ?? "";
    return (
      <div className="min-h-[100dvh] bg-background px-4 py-6 sm:flex sm:items-center sm:justify-center">
        <div className="mx-auto w-full max-w-md space-y-5">
          <StepIndicator current={4} />
          <Card>
            <CardHeader className="items-center text-center">
              <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-success text-success-foreground">
                <Check className="h-7 w-7" aria-hidden="true" />
              </div>
              <CardTitle className="text-xl">Reservation Confirmed!</CardTitle>
              <p className="text-sm text-muted-foreground">
                Thank you, {responsibleName}. Your tickets are reserved.
                {isOther && <> They are registered under {ownerName}.</>}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border bg-muted/50 p-4 text-center">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Reservation Reference
                </div>
                <div className="break-all font-mono text-3xl font-bold tabular-nums">
                  {reservation.display_id}
                </div>
                <div
                  className={
                    "mt-3 grid gap-2 " +
                    (canShare ? "grid-cols-2" : "grid-cols-1")
                  }
                >
                  <Button
                    variant="outline"
                    className="h-11"
                    onClick={() => void copyReference(reservation.display_id)}
                  >
                    <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
                    Copy reference
                  </Button>
                  {canShare && (
                    <Button
                      variant="outline"
                      className="h-11"
                      onClick={() => void shareReservation(reservation)}
                    >
                      <Share2 className="mr-2 h-4 w-4" aria-hidden="true" />
                      Share
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between gap-4 text-sm">
                  <span className="text-muted-foreground">
                    {isOther ? "Ticket owner" : "Reserved for"}
                  </span>
                  <span className="text-right font-medium">{ownerName}</span>
                </div>
                {isOther && (
                  <div className="flex justify-between gap-4 text-sm">
                    <span className="text-muted-foreground">Reserved by</span>
                    <span className="text-right font-medium">
                      {responsibleName}
                    </span>
                  </div>
                )}
                {contactNumber && (
                  <div className="flex justify-between gap-4 text-sm">
                    <span className="text-muted-foreground">Contact</span>
                    <span className="text-right font-medium">
                      {contactNumber}
                    </span>
                  </div>
                )}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tickets</span>
                    <span className="font-medium">
                      {reservation.ticket_count} total
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {reservedNumbers.map((n) => (
                      <Badge
                        key={String(n)}
                        variant="secondary"
                        className="text-xs tabular-nums"
                      >
                        {padTicket(n)}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex justify-between border-t pt-3 text-sm">
                  <span className="text-muted-foreground">Total amount</span>
                  <span className="font-semibold">
                    {formatPeso(totalAmount)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Amount paid</span>
                  <span className="font-medium">{formatPeso(amountPaid)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Balance due</span>
                  <span className="font-semibold">
                    {formatPeso(balanceDue)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Payment status</span>
                  <Badge
                    variant={
                      paymentStatus === "paid"
                        ? "success"
                        : paymentStatus === "partially_paid"
                          ? "warning"
                          : "secondary"
                    }
                  >
                    {paymentStatus.replace(/_/g, " ")}
                  </Badge>
                </div>
              </div>

              {notes.trim() && (
                <div className="rounded-md border bg-muted/50 p-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Notes
                  </div>
                  <div className="break-words text-sm">
                    {notes.trim().slice(0, notesLimit)}
                  </div>
                </div>
              )}

              <Button
                variant="outline"
                className="h-12 w-full text-base"
                onClick={() => {
                  // Keep the responsible person's name and contact: they are
                  // usually the same person making several reservations.
                  setBeneficiaryType(null);
                  setTicketOwnerName("");
                  setNotes("");
                  setDetailsAttempted(false);
                  setSelected(new Set());
                  setReservation(null);
                  setReviewOpen(false);
                  setShowSelected(false);
                  setShowTyped(false);
                  setDirectInput("");
                  setTicketSearch("");
                  setPage(1);
                  setStep("who");
                  void loadTickets("", 1);
                }}
              >
                Make Another Reservation
              </Button>
            </CardContent>
            <CardFooter className="text-center">
              <p className="w-full text-xs text-muted-foreground">
                Save your reference:{" "}
                <span className="font-mono font-bold">
                  {reservation.display_id}
                </span>
                . Present it for inquiries or payment.
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  return null;
}
