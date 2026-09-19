import { apiFetch } from "./api";
import type { DesignElement, TicketDesignPayload } from "@/lib/ticketDesign";

export async function fetchTicketDesign(): Promise<TicketDesignPayload> {
  return apiFetch<TicketDesignPayload>("/api/ticket-design/");
}

export interface SaveDesignInput {
  layout: DesignElement[];
  pageSize: string;
  orientation: string;
  columns: number;
  rows: number;
  marginMm: number;
  gapMm: number;
  /** New background image to upload (replaces any existing one). */
  backgroundFile?: File | null;
  /** Remove the stored background image. */
  clearBackground?: boolean;
}

/**
 * Save the ticket design.  Sent as multipart/form-data so the background
 * image can be uploaded in the same request as the layout JSON.
 */
export async function saveTicketDesign(
  input: SaveDesignInput
): Promise<TicketDesignPayload> {
  const form = new FormData();
  form.append("layout", JSON.stringify(input.layout));
  form.append("page_size", input.pageSize);
  form.append("page_orientation", input.orientation);
  form.append("page_columns", String(input.columns));
  form.append("page_rows", String(input.rows));
  form.append("margin_mm", String(input.marginMm));
  form.append("gap_mm", String(input.gapMm));
  if (input.backgroundFile) form.append("background", input.backgroundFile);
  if (input.clearBackground) form.append("clear_background", "true");

  return apiFetch<TicketDesignPayload>("/api/ticket-design/", {
    method: "PUT",
    body: form,
  });
}