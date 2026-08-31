type ActiveRequestIdRef = { current: string | null };

/** Attach the request id used by /api/chat/cancel to a chat request. */
export function fetchChatWithRequestId(
  activeRequestIdRef: ActiveRequestIdRef,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  activeRequestIdRef.current = requestId;
  const headers = new Headers(init?.headers);
  headers.set("X-EduAI-Request-Id", requestId);
  return fetch(input, { ...init, headers });
}

/** Best-effort request-specific cancellation for the chat Stop control. */
export function cancelChatRequest(activeRequestIdRef: ActiveRequestIdRef): void {
  const requestId = activeRequestIdRef.current;
  activeRequestIdRef.current = null;
  if (!requestId) return;

  const body = JSON.stringify({ requestId });
  let queued = false;
  if (navigator.sendBeacon instanceof Function) {
    try {
      queued = navigator.sendBeacon(
        "/api/chat/cancel",
        new Blob([body], { type: "application/json" }),
      );
    } catch {
      // Fall back to keepalive fetch below.
    }
  }

  if (!queued) {
    void fetch("/api/chat/cancel", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // Stop is best effort; the chat request's own abort still proceeds.
    });
  }
}
