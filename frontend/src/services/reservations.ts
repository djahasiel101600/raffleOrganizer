import { apiFetch } from "./api";
import type { Paginated, Payment, ReservationSummary } from "@/types";

export interface ReservationQuery {
  search?: string;
  ticket?: string;
  status?: "active" | "cancelled";
  payment_status?: "unpaid" | "partially_paid" | "paid" | "cancelled";
  source?: "public" | "authenticated";
  page?: number;
  pageSize?: number;
}

export interface CreateReservationPayload {
  customer_name: string;
  contact_number?: string;
  notes?: string;
  ticket_numbers: number[];
  source?: "public" | "authenticated";
  price_per_ticket?: number | string;
}

export interface RecordPaymentPayload {
  amount: number | string;
  payment_method?: string;
  notes?: string;
}

export async function fetchReservations(
  query: ReservationQuery = {}
): Promise<Paginated<ReservationSummary>> {
  const params = new URLSearchParams();
  if (query.search) {
    params.set("search", query.search);
    // A purely numeric search also acts as a ticket-number lookup.
    if (/^\d+$/.test(query.search.trim())) {
      params.set("ticket", query.search.trim());
    }
  }
  if (query.status) params.set("status", query.status);
  if (query.payment_status) params.set("payment_status", query.payment_status);
  if (query.source) params.set("source", query.source);
  if (query.pageSize) params.set("page_size", String(query.pageSize));
  params.set("page", String(query.page ?? 1));
  return apiFetch<Paginated<ReservationSummary>>(
    `/api/reservations/?${params.toString()}`
  );
}

export async function fetchReservation(id: number): Promise<ReservationSummary> {
  return apiFetch<ReservationSummary>(`/api/reservations/${id}/`);
}

export async function createReservation(
  payload: CreateReservationPayload
): Promise<ReservationSummary> {
  return apiFetch<ReservationSummary>("/api/reservations/", {
    method: "POST",
    body: payload,
  });
}

export async function cancelReservation(id: number): Promise<ReservationSummary> {
  return apiFetch<ReservationSummary>(`/api/reservations/${id}/cancel/`, {
    method: "POST",
  });
}

export async function fetchPayments(
  reservationId: number
): Promise<Payment[]> {
  return apiFetch<Payment[]>(
    `/api/reservations/${reservationId}/payments/`
  );
}

export async function recordPayment(
  reservationId: number,
  payload: RecordPaymentPayload
): Promise<Payment> {
  return apiFetch<Payment>(`/api/reservations/${reservationId}/payment/`, {
    method: "POST",
    body: payload,
  });
}