import { apiFetch } from "./api";
import type { Paginated, Ticket } from "@/types";

export interface TicketQuery {
  status?: "available" | "reserved";
  search?: string;
  page?: number;
  page_size?: number;
}

export async function fetchTickets(query: TicketQuery = {}): Promise<Paginated<Ticket>> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.search) params.set("search", query.search);
  params.set("page", String(query.page ?? 1));
  params.set("page_size", String(query.page_size ?? 100));
  return apiFetch<Paginated<Ticket>>(`/api/tickets/?${params.toString()}`);
}