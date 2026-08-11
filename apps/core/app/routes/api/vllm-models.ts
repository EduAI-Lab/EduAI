import type { LoaderFunctionArgs } from "react-router";
import { resolveVllmApiKey } from "~/lib/ai/vllm-api-key.server";
import { getRequestSession } from "~/lib/auth/request-session.server";

function resolveVllmBaseUrl(raw: string): string {
  let base = raw.replace(/\/$/, "");
  if (!base.endsWith("/v1")) {
    base = `${base}/v1`;
  }
  return base;
}

function formatVllmFetchError(err: {
  name?: string;
  code?: string;
  message?: string;
}): string {
  if (err.name === "AbortError") {
    return "Request timeout — vLLM proxy did not respond within 10s";
  }
  if (err.code === "ECONNREFUSED") {
    return "Connection refused — set VLLM_BASE_URL in apps/core/.env on the server (e.g. http://cmps01.ok.ubc.ca:8001) and ensure LiteLLM is running";
  }
  if (
    err.code === "ERR_SSL_WRONG_VERSION_NUMBER" ||
    err.message?.includes("wrong version number")
  ) {
    return "Use http:// not https:// for VLLM_BASE_URL (vLLM speaks plain HTTP)";
  }
  return err.message || "Failed to connect to vLLM proxy";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);
  if (!session?.user || session.user.role !== "ADMIN") {
    return new Response("Forbidden: Admins only", { status: 403 });
  }

  const vllmPort = process.env.VLLM_PORT || "8001";
  const rawBase =
    process.env.VLLM_BASE_URL || `http://localhost:${vllmPort}`;
  const baseUrl = resolveVllmBaseUrl(rawBase);
  const apiKey = resolveVllmApiKey();
  if (!apiKey) {
    return Response.json(
      { error: "VLLM_API_KEY is not configured (required in production)" },
      { status: 503 },
    );
  }

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
          hint: "Check LiteLLM proxy on cmps01 (infra/cmps01/README.md)",
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
    const err = error as { name?: string; code?: string; message?: string };

    return new Response(
      JSON.stringify({
        error: formatVllmFetchError(err),
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
