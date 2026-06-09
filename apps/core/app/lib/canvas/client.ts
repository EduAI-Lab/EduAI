export type CanvasIntegrationPublic = {
  canvasUrl: string;
  isTestMode: boolean;
  isConnected: true;
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
