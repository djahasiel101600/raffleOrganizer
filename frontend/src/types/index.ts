export type TicketStatus = "available" | "reserved";
export type ReservationStatus = "active" | "cancelled";
export type PaymentStatus = "unpaid" | "partially_paid" | "paid" | "cancelled";
export type ReservationSource = "public" | "authenticated";

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
  notes?: string;
  status: ReservationStatus;
  source: ReservationSource;
  price_per_ticket: string;
  total_amount: string;
  amount_paid: string;
  balance_due: string;
  payment_status: PaymentStatus;
  payment_date: string | null;
  payment_notes: string;
  processed_by: string | null;
  ticket_numbers: string[];
  /** Subset of `ticket_numbers` that is still active and therefore printable. */
  printable_ticket_numbers: string[];
  ticket_count: number;
  created_at: string;
  reserved_at: string;
  updated_at: string;
  cancelled_at: string | null;
}

export interface Payment {
  id: number;
  reservation: number;
  amount: string;
  payment_date: string;
  payment_method: string;
  notes: string;
  processed_by: string | null;
  created_at: string;
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
  ticket_price: number;
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