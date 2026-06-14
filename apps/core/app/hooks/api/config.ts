/** Platform hooks that have no Core API yet — use fixtures until backend lands. */
export const STUB_ONLY = {
  bugReports: true,
  // DELETE /api/chats/:chatId is implemented (owner / admin). Chat-history UI
  // wires it live.
  deleteChat: false,
} as const;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function parseErrorMessage(text: string): string {
  try {
    const json = JSON.parse(text) as { error?: string };
    return json.error ?? text;
  } catch {
    return text || "Request failed";
  }
}

/** Session-cookie fetch wrapper for Core `/api/*` routes. */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...init, headers });

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, parseErrorMessage(text));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
