/**
 * Real-time reservation updates over WebSockets.
 *
 * Exposes a small `ReservationSocket` class plus a `useReservationSocket`
 * React hook. Reconnection is handled automatically with capped exponential
 * backoff, and the connection status is reported so pages can show
 * "● LIVE" / "○ RECONNECTING…" indicators.
 */

import { useCallback, useEffect, useState } from "react";

import type { ReservationEvent } from "@/types";
import { getAccessToken } from "./api";

export type SocketStatus = "connecting" | "connected" | "reconnecting";

function websocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const token = getAccessToken();
  const base = `${protocol}://${window.location.host}/ws/reservations/`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

type Listener = (event: ReservationEvent) => void;

class ReservationSocket {
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private shouldReconnect = true;
  private reconnectTimer: number | null = null;
  private listeners = new Set<Listener>();
  private status: SocketStatus = "connecting";
  private statusListener: ((status: SocketStatus) => void) | null = null;

  connect(): void {
    this.shouldReconnect = true;
    // Idempotent: do not stack sockets (React StrictMode calls effects twice).
    if (this.socket && (this.status === "connected" || this.status === "connecting")) {
      return;
    }
    this.open();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
  }

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onStatusChange(listener: (status: SocketStatus) => void): () => void {
    this.statusListener = listener;
    return () => {
      if (this.statusListener === listener) this.statusListener = null;
    };
  }

  private open(): void {
    if (!this.shouldReconnect) return;
    this.setStatus("connecting");
    const socket = new WebSocket(websocketUrl());
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("connected");
    };

    socket.onmessage = (message) => {
      try {
        const data = JSON.parse(message.data) as ReservationEvent;
        this.listeners.forEach((listener) => listener(data));
      } catch {
        /* ignore malformed frames */
      }
    };

    socket.onclose = () => {
      this.socket = null;
      if (this.shouldReconnect) this.scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose always follows onerror; let onclose drive reconnection.
    };
  }

  private scheduleReconnect(): void {
    this.setStatus("reconnecting");
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15000);
    this.reconnectAttempts += 1;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => this.open(), delay);
  }

  private setStatus(status: SocketStatus): void {
    this.status = status;
    this.statusListener?.(status);
  }
}

const sharedSocket = new ReservationSocket();

/**
 * Subscribe to reservation events. The socket connects on first use and
 * automatically reconnects forever after (until the page unloads).
 */
export function useReservationSocket(): {
  status: SocketStatus;
  subscribe: (listener: Listener) => () => void;
} {
  const [status, setStatus] = useState<SocketStatus>("connecting");

  useEffect(() => {
    const unsubscribeStatus = sharedSocket.onStatusChange(setStatus);
    sharedSocket.connect();
    return () => {
      unsubscribeStatus();
    };
  }, []);

  const subscribe = useCallback((listener: Listener) => {
    return sharedSocket.onEvent(listener);
  }, []);

  return { status, subscribe };
}

/** Connection indicator copy for the UI. */
export function connectionLabel(status: SocketStatus): string {
  if (status === "connected") return "LIVE";
  if (status === "reconnecting") return "RECONNECTING…";
  return "CONNECTING…";
}