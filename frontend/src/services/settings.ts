import { apiFetch } from "./api";
import type { RaffleSettings } from "@/types";

export interface InitializeResult {
  created: number;
  total: number;
  start: number;
  end: number;
}

export async function fetchSettings(): Promise<RaffleSettings> {
  return apiFetch<RaffleSettings>("/api/settings/");
}

export async function updateSettings(
  payload: Partial<RaffleSettings>
): Promise<RaffleSettings> {
  return apiFetch<RaffleSettings>("/api/settings/", {
    method: "PUT",
    body: payload,
  });
}

export async function initializeTickets(params: {
  start: number;
  end: number;
  padding: number;
  force: boolean;
}): Promise<InitializeResult> {
  return apiFetch<InitializeResult>("/api/settings/initialize-tickets/", {
    method: "POST",
    body: params,
  });
}