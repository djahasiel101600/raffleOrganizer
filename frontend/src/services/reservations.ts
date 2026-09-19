import { apiFetch } from "./api";
import type { Paginated, ReservationSummary } from "@/types";

export interface ReservationQuery {
  search?: string;
  ticket?: string;
  status?: "active" | "cancelled";
  page?: number;
  pageSize?: number;
}

export interface CreateReservationPayload {
  customer_name: string;
  contact_number?: string;
  notes?: string;
  ticket_numbers: number[];
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