import { request as undiciRequest } from "undici";

const CANVAS_VERIFY_TIMEOUT_MS = 10_000;
const CANVAS_REQUEST_TIMEOUT_MS = 30_000;
const CANVAS_FILE_DOWNLOAD_MAX_REDIRECTS = 10;
const CANVAS_PAGE_SIZE = 100;
const LOCAL_CANVAS_DOCKER_HOST = "canvas.docker";

export const CANVAS_EXTERNAL_SOURCE = "canvas";

export type CanvasIntegrationCredentials = {
  canvasUrl: string;
  apiKey: string;
  isTestMode: boolean;
};

export type CanvasTermApi = {
  id: number;
  name?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  workflow_state?: string;
};

export type CanvasCourseApi = {
  id: number;
  name: string;
  course_code?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  workflow_state?: string;
  term?: CanvasTermApi | null;
};

export type CanvasCourseUserApi = {
  id: number;
  name?: string | null;
  email?: string | null;
  sis_user_id?: string | null;
};

export type CanvasFileApi = {
  id: number;
  display_name: string;
  filename: string;
  "content-type": string;
  size: number;
  updated_at: string;
  url: string;
  hidden?: boolean;
  locked?: boolean;
  lock_at?: string | null;
  unlock_at?: string | null;
};

/** Computes whether a Canvas file is currently visible to students (not hidden/locked/outside its unlock-lock window). */
export function computeCanvasFilePublishState(
  file: Pick<CanvasFileApi, "hidden" | "locked" | "lock_at" | "unlock_at">,
  now: Date = new Date(),
): { isPublished: boolean } {
  if (file.hidden || file.locked) {
    return { isPublished: false };
  }
  if (file.unlock_at && new Date(file.unlock_at) > now) {
    return { isPublished: false };
  }
  if (file.lock_at && new Date(file.lock_at) <= now) {
    return { isPublished: false };
  }
  return { isPublished: true };
}

export type CanvasModuleItemApi = {
  id: number;
  type: string;
  content_id?: number | null;
  title?: string | null;
};

export type CanvasModuleApi = {
  id: number;
  name: string;
  items?: CanvasModuleItemApi[];
};

const MOCK_CANVAS_COURSES: CanvasCourseApi[] = [
  { id: 1, name: "Introduction to Computer Science", course_code: "COSC 101", start_at: "2026-01-06T08:00:00Z", end_at: "2026-04-30T23:59:59Z" },
  { id: 2, name: "Data Structures and Algorithms", course_code: "COSC 201", start_at: "2026-01-06T08:00:00Z", end_at: "2026-04-30T23:59:59Z" },
  { id: 3, name: "Machine Architecture", course_code: "COSC 211", start_at: "2026-01-06T08:00:00Z", end_at: "2026-04-30T23:59:59Z" },
];

const MOCK_CANVAS_ROSTER: Record<number, CanvasCourseUserApi[]> = {
  1: [
    { id: 101, name: "Student One", email: "student1@example.com", sis_user_id: "student_1" },
    { id: 102, name: "Student Two", email: "student2@example.com", sis_user_id: "student_2" },
  ],
  2: [{ id: 103, name: "Student Three", email: "student3@example.com", sis_user_id: "student_3" }],
  3: [],
};

const MOCK_CANVAS_FILES: Record<number, CanvasFileApi[]> = {
  1: [
    {
      id: 1001,
      display_name: "Lecture 1 - Intro.txt",
      filename: "lecture1.txt",
      "content-type": "text/plain",
      size: 2048,
      updated_at: "2025-01-10T12:00:00.000Z",
      url: "mock://canvas/files/1001",
    },
    {
      id: 1002,
      display_name: "Week 1 Notes.txt",
      filename: "week1.txt",
      "content-type": "text/plain",
      size: 512,
      updated_at: "2025-01-12T09:00:00.000Z",
      url: "mock://canvas/files/1002",
    },
  ],
  2: [
    {
      id: 2001,
      display_name: "Algorithms Overview.pptx",
      filename: "algorithms.pptx",
      "content-type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size: 4096,
      updated_at: "2025-02-01T10:00:00.000Z",
      url: "mock://canvas/files/2001",
    },
  ],
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
  if (path.includes("/courses") && path.includes("/files")) {
    const courseMatch = path.match(/\/courses\/(\d+)\/files/);
    if (courseMatch) {
      const courseId = Number(courseMatch[1]);
      return (MOCK_CANVAS_FILES[courseId] ?? []) as T[];
    }
  }

  if (path.includes("/courses") && path.includes("/modules")) {
    return [] as T[];
  }

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
    "/courses?enrollment_type=teacher&enrollment_role=TeacherEnrollment&include[]=term",
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

/** Lists files uploaded to a Canvas course. */
export async function listCanvasCourseFiles(
  credentials: CanvasIntegrationCredentials,
  canvasCourseId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CanvasFileApi[]> {
  return canvasGetPaginated<CanvasFileApi>(
    credentials,
    `/courses/${canvasCourseId}/files`,
    fetchImpl,
  );
}

/** Lists modules (with items) for a Canvas course. */
export async function listCanvasCourseModules(
  credentials: CanvasIntegrationCredentials,
  canvasCourseId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CanvasModuleApi[]> {
  return canvasGetPaginated<CanvasModuleApi>(
    credentials,
    `/courses/${canvasCourseId}/modules?include[]=items`,
    fetchImpl,
  );
}

/** Rewrites Canvas file URLs to the configured canvasUrl origin (local Docker DOMAIN mismatch). */
export function resolveCanvasFileDownloadUrl(fileUrl: string, canvasUrl: string): string {
  const fileParsed = new URL(fileUrl);
  const canvasParsed = parseAndValidateCanvasUrl(canvasUrl);
  return `${canvasParsed.origin}${fileParsed.pathname}${fileParsed.search}`;
}

function isLocalCanvasDev(canvasUrl: string): boolean {
  const parsed = parseAndValidateCanvasUrl(canvasUrl);
  return parsed.protocol === "http:" && HTTP_ALLOWED_HOSTNAMES.has(parsed.hostname.toLowerCase());
}

function shouldUseLocalCanvasDockerTransport(canvasUrl: string, fileUrl: string): boolean {
  if (!isLocalCanvasDev(canvasUrl)) {
    return false;
  }
  const host = new URL(fileUrl).hostname.toLowerCase();
  return host === LOCAL_CANVAS_DOCKER_HOST || HTTP_ALLOWED_HOSTNAMES.has(host);
}

type CanvasFileDownloadResponse = {
  status: number;
  getHeader(name: string): string | null;
  arrayBuffer(): Promise<ArrayBuffer>;
};

async function performCanvasFileDownloadRequest(
  url: string,
  headers: Record<string, string>,
  credentials: CanvasIntegrationCredentials,
  fetchImpl: typeof fetch,
): Promise<CanvasFileDownloadResponse> {
  const useUndici =
    fetchImpl === fetch &&
    process.env.VITEST !== "true" &&
    shouldUseLocalCanvasDockerTransport(credentials.canvasUrl, url);

  if (useUndici) {
    const requestUrl = resolveCanvasFileDownloadUrl(url, credentials.canvasUrl);
    const { statusCode, headers: responseHeaders, body } = await undiciRequest(requestUrl, {
      headers: {
        ...headers,
        host: LOCAL_CANVAS_DOCKER_HOST,
      },
      signal: AbortSignal.timeout(CANVAS_REQUEST_TIMEOUT_MS),
    });
    const normalizedHeaders = new Headers(responseHeaders as Record<string, string>);
    return {
      status: statusCode,
      getHeader: (name) => normalizedHeaders.get(name),
      arrayBuffer: () => body.arrayBuffer(),
    };
  }

  const response = await fetchImpl(url, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(CANVAS_REQUEST_TIMEOUT_MS),
  });
  return {
    status: response.status,
    getHeader: (name) => response.headers.get(name),
    arrayBuffer: () => response.arrayBuffer(),
  };
}

async function fetchCanvasFileBytes(
  credentials: CanvasIntegrationCredentials,
  initialUrl: string,
  fetchImpl: typeof fetch,
): Promise<Uint8Array> {
  let url = resolveCanvasFileDownloadUrl(initialUrl, credentials.canvasUrl);

  for (let redirectCount = 0; redirectCount <= CANVAS_FILE_DOWNLOAD_MAX_REDIRECTS; redirectCount++) {
    const headers: Record<string, string> = {};
    if (!url.includes("sf_verifier")) {
      headers.Authorization = `Bearer ${credentials.apiKey}`;
    }

    const response = await performCanvasFileDownloadRequest(
      url,
      headers,
      credentials,
      fetchImpl,
    );

    if (response.status >= 300 && response.status < 400) {
      const location = response.getHeader("location");
      if (!location) {
        throw new CanvasApiError(
          `Canvas file download redirect missing Location (${response.status})`,
          502,
        );
      }
      url = resolveCanvasFileDownloadUrl(new URL(location, url).href, credentials.canvasUrl);
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new CanvasApiError(`Canvas file download failed: ${response.status}`, response.status);
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  throw new CanvasApiError("Canvas file download exceeded redirect limit", 502);
}

/** Downloads a Canvas file by its authenticated URL. */
export async function downloadCanvasFile(
  credentials: CanvasIntegrationCredentials,
  file: Pick<CanvasFileApi, "id" | "url" | "filename" | "content-type">,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  if (credentials.isTestMode) {
    const text = `Mock Canvas file content for ${file.filename}`;
    return new Uint8Array(Buffer.from(text));
  }

  try {
    return await fetchCanvasFileBytes(credentials, file.url, fetchImpl);
  } catch (error) {
    if (error instanceof CanvasApiError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : "fetch failed";
    throw new CanvasApiError(
      `Canvas file download failed: ${detail}. Check that your Canvas URL in Settings matches a host reachable from EduAI (e.g. http://localhost:8080).`,
      502,
    );
  }
}
