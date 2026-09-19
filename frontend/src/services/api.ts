/**
 * Centralized API client.
 *
 * All requests go through `apiFetch`, which attaches the JWT access token,
 * refreshes it transparently when it expires, and normalizes errors into a
 * small `ApiError` shape. Components and service modules never call `fetch`
 * directly.
 */

import type { LoginResponse } from "@/types";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

const ACCESS_KEY = "raf_access_token";
const REFRESH_KEY = "raf_refresh_token";

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(tokens: LoginResponse): void {
  localStorage.setItem(ACCESS_KEY, tokens.access);
  localStorage.setItem(REFRESH_KEY, tokens.refresh);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export class ApiClientError extends Error {
  status: number;
  code?: string;
  detail?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.detail = message;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: boolean;
  retry?: boolean;
}

async function parseErrorResponse(response: Response): Promise<ApiClientError> {
  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json();
  } catch {
    /* non-JSON body */
  }
  const detail =
    typeof payload.detail === "string"
      ? payload.detail
      : `Request failed (${response.status}).`;
  return new ApiClientError(
    response.status,
    detail,
    typeof payload.code === "string" ? payload.code : undefined
  );
}

async function rawFetch(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body instanceof FormData) {
    // Let the browser set the multipart boundary header.
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (options.auth !== false) {
    const token = getAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  return fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body:
      options.body instanceof FormData
        ? options.body
        : options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined,
  });
}

async function refreshAccessToken(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  const response = await fetch(`${API_BASE}/api/auth/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!response.ok) {
    clearTokens();
    return false;
  }
  const tokens = (await response.json()) as { access: string };
  setTokens({ access: tokens.access, refresh });
  return true;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await rawFetch(path, options);

  // Transparently refresh an expired access token once.
  if (response.status === 401 && options.auth !== false && options.retry !== false) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      response = await rawFetch(path, options);
    }
  }

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}