/** Kill-switches for falling back to fixtures; every Core API these gate is live, so both are `false`. */
export const STUB_ONLY = {
  bugReports: false,
  deleteChat: false,
} as const;

export class ApiError extends Error {
  readonly status: number;
  /** Per-field detail from the error envelope, e.g. the courses behind a 409. */
  readonly fields?: Record<string, string>;

  constructor(status: number, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
  }
}

interface ParsedErrorBody {
  message: string;
  fields?: Record<string, string>;
}

function parseErrorBody(text: string): ParsedErrorBody {
  try {
    const json = JSON.parse(text) as { error?: string; fields?: Record<string, string> };
    return { message: json.error ?? text, fields: json.fields };
  } catch {
    return { message: text || "Request failed" };
  }
}

/** Session-cookie fetch wrapper for Core `/api/*` routes. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...init, headers });

  if (!response.ok) {
    const text = await response.text();
    const { message, fields } = parseErrorBody(text);
    throw new ApiError(response.status, message, fields);
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
