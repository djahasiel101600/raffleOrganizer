import { apiFetch } from "./api";
import type { DashboardStats, MonitorData } from "@/types";

export async function fetchDashboard(): Promise<DashboardStats> {
  return apiFetch<DashboardStats>("/api/dashboard/");
}

export async function fetchMonitor(): Promise<MonitorData> {
  return apiFetch<MonitorData>("/api/monitor/", { auth: false });
}