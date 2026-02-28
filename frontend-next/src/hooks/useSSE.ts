"use client";

import { useEffect, useRef, useCallback } from "react";

export interface SSEEvent {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
}

interface UseSSEOptions {
  sessionId: string | null;
  enabled: boolean;
  onEvent: (event: SSEEvent) => void;
  onFallback?: () => void;
}

const EVENT_TYPES = [
  "connected",
  "session_status",
  "tracks_ready",
  "user_tracks_ready",
  "analysis_progress",
  "analysis_complete",
  "analysis_error",
  "heartbeat",
  "timeout",
] as const;

const MAX_RECONNECTS = 3;

/**
 * Hook for Server-Sent Events with automatic fallback to polling.
 *
 * Connects to /api/session/{id}/stream and dispatches typed events.
 * After MAX_RECONNECTS failures, calls onFallback() so the component
 * can activate polling as a degraded mode.
 */
export function useSSE({
  sessionId,
  enabled,
  onEvent,
  onFallback,
}: UseSSEOptions) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectCountRef = useRef(0);
  const onEventRef = useRef(onEvent);
  const onFallbackRef = useRef(onFallback);

  // Keep refs current to avoid stale closures in EventSource listeners
  onEventRef.current = onEvent;
  onFallbackRef.current = onFallback;

  const connect = useCallback(() => {
    if (!sessionId || !enabled) return;

    // Close any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = `/api/session/${sessionId}/stream`;
    const es = new EventSource(url);

    for (const type of EVENT_TYPES) {
      es.addEventListener(type, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          onEventRef.current({ type, data });
          reconnectCountRef.current = 0; // Reset on success
        } catch (err) {
          console.error("[SSE] Parse error:", err);
        }
      });
    }

    es.onerror = () => {
      es.close();

      if (reconnectCountRef.current < MAX_RECONNECTS) {
        reconnectCountRef.current++;
        const delay = 2000 * reconnectCountRef.current;
        console.warn(
          `[SSE] Connection error, retry ${reconnectCountRef.current}/${MAX_RECONNECTS} in ${delay}ms`,
        );
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      } else {
        console.warn("[SSE] Max reconnects reached, falling back to polling");
        onFallbackRef.current?.();
      }
    };

    eventSourceRef.current = es;
  }, [sessionId, enabled]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [connect]);

  return {
    close: () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    },
  };
}
