import { apiFetch, setTokens, clearTokens } from "./api";
import type { LoginResponse } from "@/types";

export async function login(username: string, password: string): Promise<LoginResponse> {
  const tokens = await apiFetch<LoginResponse>("/api/auth/login/", {
    method: "POST",
    auth: false,
    body: { username, password },
  });
  setTokens(tokens);
  return tokens;
}

export async function logout(): Promise<void> {
  clearTokens();
}