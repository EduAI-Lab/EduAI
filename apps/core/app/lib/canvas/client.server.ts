const CANVAS_VERIFY_TIMEOUT_MS = 10_000;
const CANVAS_REQUEST_TIMEOUT_MS = 30_000;
const CANVAS_PAGE_SIZE = 100;

export const CANVAS_EXTERNAL_SOURCE = "canvas";

export type CanvasIntegrationCredentials = {
  canvasUrl: string;
  apiKey: string;
  isTestMode: boolean;
};

export type CanvasCourseApi = {
  id: number;
  name: string;
  course_code?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  workflow_state?: string;
};

export type CanvasCourseUserApi = {
  id: number;
  name?: string | null;
  email?: string | null;
  sis_user_id?: string | null;
};

const MOCK_CANVAS_COURSES: CanvasCourseApi[] = [
  { id: 1, name: "Introduction to Computer Science", course_code: "COSC 101" },
  { id: 2, name: "Data Structures and Algorithms", course_code: "COSC 201" },
  { id: 3, name: "Machine Architecture", course_code: "COSC 211" },
];

const MOCK_CANVAS_ROSTER: Record<number, CanvasCourseUserApi[]> = {
  1: [
    { id: 101, name: "Student One", email: "student1@example.com", sis_user_id: "student_1" },
    { id: 102, name: "Student Two", email: "student2@example.com", sis_user_id: "student_2" },
  ],
  2: [{ id: 103, name: "Student Three", email: "student3@example.com", sis_user_id: "student_3" }],
  3: [],
};

export class CanvasApiError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "CanvasApiError";
    this.statusCode = statusCode;
  }
}

/** Hostnames allowed to use plain HTTP (local Canvas dev). Production must use HTTPS. */
const HTTP_ALLOWED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "canvas.docker",
]);

export class CanvasVerificationError extends Error {
  readonly statusCode: 400 | 502;

  constructor(message: string, statusCode: 400 | 502) {
    super(message);
    this.name = "CanvasVerificationError";
    this.statusCode = statusCode;
  }
}

/** Validates Canvas base URL before server-side fetch (SSRF guard). */
export function parseAndValidateCanvasUrl(canvasUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(canvasUrl);
  } catch {
    throw new CanvasVerificationError("Invalid Canvas URL format", 400);
  }

  if (parsed.protocol === "https:") {
    return parsed;
  }

  if (parsed.protocol === "http:") {
    const hostname = parsed.hostname.toLowerCase();
    if (HTTP_ALLOWED_HOSTNAMES.has(hostname)) {
      return parsed;
    }
    throw new CanvasVerificationError(
      "Canvas URL must use HTTPS except for local development hosts",
      400,
    );
  }

  throw new CanvasVerificationError("Canvas URL must use HTTP or HTTPS", 400);
}

function buildCanvasProfileUrl(canvasUrl: string): string {
  const parsed = parseAndValidateCanvasUrl(canvasUrl);
  return `${parsed.origin}/api/v1/users/self/profile`;
}

/** Probes Canvas with the personal access token before persisting credentials. */
export async function verifyCanvasCredentials(
  canvasUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const url = buildCanvasProfileUrl(canvasUrl);

  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(CANVAS_VERIFY_TIMEOUT_MS),
    });

    if (response.status === 401 || response.status === 403) {
      throw new CanvasVerificationError("Invalid Canvas API token", 400);
    }

    if (!response.ok) {
      throw new CanvasVerificationError(`Canvas returned ${response.status}`, 502);
    }
  } catch (error) {
    if (error instanceof CanvasVerificationError) {
      throw error;
    }
    throw new CanvasVerificationError("Could not reach Canvas", 502);
  }
}

function buildCanvasApiUrl(canvasUrl: string, path: string): string {
  const parsed = parseAndValidateCanvasUrl(canvasUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${parsed.origin}/api/v1${normalizedPath}`;
}

function parseLinkHeaderNextUrl(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }

  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

async function canvasFetchJson<T>(
  url: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<{ data: T; linkHeader: string | null }> {
  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(CANVAS_REQUEST_TIMEOUT_MS),
    });

    if (response.status === 401 || response.status === 403) {
      throw new CanvasApiError("Invalid Canvas API token", 401);
    }

    if (!response.ok) {
      throw new CanvasApiError(`Canvas API error: ${response.status}`, response.status);
    }

    const data = (await response.json()) as T;
    return { data, linkHeader: response.headers.get("link") };
  } catch (error) {
    if (error instanceof CanvasApiError || error instanceof CanvasVerificationError) {
      throw error;
    }
    throw new CanvasApiError("Could not reach Canvas", 502);
  }
}

/** Fetches all pages from a Canvas list endpoint. */
export async function canvasGetPaginated<T>(
  credentials: CanvasIntegrationCredentials,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T[]> {
  if (credentials.isTestMode) {
    return getMockPaginatedResponse<T>(path);
  }

  const separator = path.includes("?") ? "&" : "?";
  let nextUrl: string | null = buildCanvasApiUrl(
    credentials.canvasUrl,
    `${path}${separator}per_page=${CANVAS_PAGE_SIZE}`,
  );
  const results: T[] = [];

  while (nextUrl) {
    const { data, linkHeader } = await canvasFetchJson<T[]>(nextUrl, credentials.apiKey, fetchImpl);
    if (Array.isArray(data) && data.length > 0) {
      results.push(...data);
    }
    nextUrl = parseLinkHeaderNextUrl(linkHeader);
  }

  return results;
}

function getMockPaginatedResponse<T>(path: string): T[] {
  if (path.includes("/courses") && !path.includes("/users")) {
    return MOCK_CANVAS_COURSES as T[];
  }

  const courseMatch = path.match(/\/courses\/(\d+)\/users/);
  if (courseMatch) {
    const courseId = Number(courseMatch[1]);
    return (MOCK_CANVAS_ROSTER[courseId] ?? []) as T[];
  }

  return [];
}

/** Lists Canvas courses where the token holder is a teacher. */
export async function listTeacherCanvasCourses(
  credentials: CanvasIntegrationCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<CanvasCourseApi[]> {
  return canvasGetPaginated<CanvasCourseApi>(
    credentials,
    "/courses?enrollment_type=teacher&enrollment_role=TeacherEnrollment",
    fetchImpl,
  );
}

/** Lists students enrolled in a Canvas course. */
export async function listCanvasCourseStudents(
  credentials: CanvasIntegrationCredentials,
  canvasCourseId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CanvasCourseUserApi[]> {
  return canvasGetPaginated<CanvasCourseUserApi>(
    credentials,
    `/courses/${canvasCourseId}/users?enrollment_type[]=student&include[]=email`,
    fetchImpl,
  );
}

/** Lists TAs enrolled in a Canvas course. */
export async function listCanvasCourseTas(
  credentials: CanvasIntegrationCredentials,
  canvasCourseId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CanvasCourseUserApi[]> {
  return canvasGetPaginated<CanvasCourseUserApi>(
    credentials,
    `/courses/${canvasCourseId}/users?enrollment_type[]=ta&include[]=email`,
    fetchImpl,
  );
}
