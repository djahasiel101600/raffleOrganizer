export type TicketStatus = "available" | "reserved";
export type ReservationStatus = "active" | "cancelled";

export interface Ticket {
  id: number;
  number: number;
  display_number: string;
  status: TicketStatus;
  updated_at: string;
}

export interface ReservationSummary {
  id: number;
  display_id: string;
  customer_name: string;
  contact_number: string;
  status: ReservationStatus;
  ticket_numbers: string[];
  /** Subset of `ticket_numbers` that is still active and therefore printable. */
  printable_ticket_numbers: string[];
  ticket_count: number;
  created_at: string;
  reserved_at: string;
  updated_at: string;
  cancelled_at: string | null;
  notes?: string;
}

export interface MonitorRecentReservation {
  id: number;
  display_id: string;
  customer_name: string;
  ticket_numbers: string[];
  ticket_count: number;
  reserved_at: string;
}

export interface DashboardStats {
  raffle_name: string;
  total_tickets: number;
  reserved_tickets: number;
  available_tickets: number;
  reserved_percent: number;
  total_reservations: number;
  configured_total: number;
  recent_reservations: MonitorRecentReservation[];
}

export interface MonitorData {
  raffle_name: string;
  total_tickets: number;
  reserved_tickets: number;
  available_tickets: number;
  reserved_percent: number;
  total_reservations: number;
  configured_total: number;
  recent_reservations: MonitorRecentReservation[];
}

export interface RaffleSettings {
  raffle_name: string;
  starting_ticket_number: number;
  ending_ticket_number: number;
  ticket_number_padding: number;
  default_tickets_per_column: number;
  tickets_exist: boolean;
  ticket_count: number;
  updated_at: string;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface ReservationEvent {
  type: "reservation_created" | "reservation_cancelled";
  reservation_id: number;
  reservation_display_id: string;
  customer_name?: string;
  ticket_numbers: string[];
  reserved_count?: number;
  reserved_at?: string;
}

export interface LoginResponse {
  access: string;
  refresh: string;
}

export interface ApiError {
  detail?: string;
  code?: string;
  [key: string]: unknown;
}