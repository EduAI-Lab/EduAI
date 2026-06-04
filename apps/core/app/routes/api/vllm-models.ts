import { auth } from "~/lib/auth/server";
import type { LoaderFunctionArgs } from "react-router";

function resolveVllmBaseUrl(raw: string): string {
  let base = raw.replace(/\/$/, "");
  if (!base.endsWith("/v1")) {
    base = `${base}/v1`;
  }
  return base;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);
  if (!session?.user || session.user.role !== "ADMIN") {
    return new Response("Forbidden: Admins only", { status: 403 });
  }

  const url = new URL(request.url);
  const vllmPort = process.env.VLLM_PORT || "8001";
  const rawBase =
    url.searchParams.get("baseUrl") ||
    process.env.VLLM_BASE_URL ||
    `http://localhost:${vllmPort}`;
  const baseUrl = resolveVllmBaseUrl(rawBase);
  const apiKey = process.env.VLLM_API_KEY || "vllm-local";

  try {
    const modelsUrl = `${baseUrl}/models`;
    const response = await fetch(modelsUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: `Failed to fetch vLLM models: ${response.status} ${response.statusText}`,
          baseUrl: modelsUrl,
        }),
        {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const data = await response.json();
    const models =
      data.data?.map((model: { id: string; owned_by?: string; created?: number }) => ({
        id: model.id,
        owned_by: model.owned_by,
        created: model.created,
      })) ?? [];

    return new Response(JSON.stringify({ models, baseUrl }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error fetching vLLM models:", error);

    let errorMessage = "Failed to connect to vLLM server";
    const err = error as { name?: string; code?: string; message?: string };
    if (err.name === "AbortError") {
      errorMessage = "Request timeout - vLLM server did not respond";
    } else if (err.code === "ECONNREFUSED") {
      errorMessage =
        "Connection refused - vLLM server is not running or not accessible";
    } else if (err.message) {
      errorMessage = err.message;
    }

    return new Response(
      JSON.stringify({
        error: errorMessage,
        baseUrl,
        details: err.code || err.name || "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
