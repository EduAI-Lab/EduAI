import type {
  CanvasCoursePickerItem,
  CanvasIntegrationPublic,
  LinkRosterResponse,
  SyncCanvasCoursesInput,
  SyncCanvasCoursesResult,
} from "~/lib/canvas/schemas";
import type {
  CanvasMaterialDiscoverItem,
  SyncCanvasMaterialsResult,
} from "@eduai/types";

export type {
  CanvasCoursePickerItem,
  CanvasIntegrationPublic,
  CanvasMaterialDiscoverItem,
  LinkRosterResponse,
  SyncCanvasCoursesInput,
  SyncCanvasCoursesResult,
  SyncCanvasMaterialsResult,
};

type CanvasApiBody<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
};

async function parseCanvasResponse<T>(response: Response): Promise<CanvasApiBody<T>> {
  return response.json() as Promise<CanvasApiBody<T>>;
}

async function canvasRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<CanvasApiBody<T>> {
  const response = await fetch(`/api/canvas/${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const body = await parseCanvasResponse<T>(response);
  if (!response.ok || body.success === false) {
    throw new Error(body.error ?? "Canvas request failed");
  }

  return body;
}

export async function getCanvasIntegration(): Promise<CanvasIntegrationPublic | null> {
  const body = await canvasRequest<CanvasIntegrationPublic | null>("integration");
  return body.data ?? null;
}

export async function connectCanvas(input: {
  canvasUrl: string;
  apiKey?: string;
  isTestMode?: boolean;
}): Promise<CanvasIntegrationPublic> {
  const body = await canvasRequest<CanvasIntegrationPublic>("connect", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!body.data) {
    throw new Error("Canvas connect did not return integration data");
  }
  return body.data;
}

export async function disconnectCanvas(): Promise<void> {
  await canvasRequest("disconnect", { method: "DELETE" });
}

export async function listCanvasCourses(): Promise<CanvasCoursePickerItem[]> {
  const body = await canvasRequest<{ courses: CanvasCoursePickerItem[] }>("courses");
  return body.data?.courses ?? [];
}

export async function syncCanvasCourses(input: SyncCanvasCoursesInput): Promise<SyncCanvasCoursesResult> {
  const body = await canvasRequest<SyncCanvasCoursesResult>("sync", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!body.data) {
    throw new Error("Canvas sync did not return result data");
  }
  return body.data;
}

async function courseCanvasMaterialsRequest<T>(
  courseId: string,
  init?: RequestInit,
): Promise<{ success: boolean; data?: T; error?: string }> {
  const response = await fetch(`/api/courses/${courseId}/canvas-materials`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const body = (await response.json()) as { success: boolean; data?: T; error?: string };
  if (!response.ok || body.success === false) {
    throw new Error(body.error ?? "Canvas material request failed");
  }

  return body;
}

export async function discoverCanvasMaterials(
  courseId: string,
): Promise<CanvasMaterialDiscoverItem[]> {
  const body = await courseCanvasMaterialsRequest<{ files: CanvasMaterialDiscoverItem[] }>(
    courseId,
  );
  return body.data?.files ?? [];
}

export async function syncCanvasMaterials(
  courseId: string,
  canvasFileIds: string[],
): Promise<SyncCanvasMaterialsResult> {
  const body = await courseCanvasMaterialsRequest<SyncCanvasMaterialsResult>(courseId, {
    method: "POST",
    body: JSON.stringify({ canvasFileIds }),
  });
  if (!body.data) {
    throw new Error("Canvas material sync did not return result data");
  }
  return body.data;
}

export async function linkCanvasRoster(studentNumber: string): Promise<LinkRosterResponse> {
  const body = await canvasRequest<LinkRosterResponse>("link-roster", {
    method: "POST",
    body: JSON.stringify({ studentNumber }),
  });
  if (!body.data) {
    throw new Error("Link roster did not return result data");
  }
  return body.data;
}
