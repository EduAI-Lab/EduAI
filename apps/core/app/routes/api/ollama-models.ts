import type { LoaderFunctionArgs } from "react-router";
import {
  InvalidOllamaBaseUrlError,
  ollamaTagsUrl,
  resolveAllowedOllamaBaseUrl,
} from "~/lib/ai/ollama-url.server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { withErrorResponse } from "~/lib/errors.server";

export async function loader({ request }: LoaderFunctionArgs) {
  return withErrorResponse(
    async () => {
      // Check admin authorization
      const session = await getRequestSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
        return new Response("Forbidden: Admins only", { status: 403 });
      }

      const url = new URL(request.url);
      const requestedBaseUrl = url.searchParams.get("baseUrl");
      let baseUrl: string;
      let ollamaUrl: string;
      try {
        baseUrl = resolveAllowedOllamaBaseUrl(requestedBaseUrl);
        ollamaUrl = ollamaTagsUrl(requestedBaseUrl);
      } catch (error) {
        if (error instanceof InvalidOllamaBaseUrlError) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw error;
      }

      try {
        const response = await fetch(ollamaUrl, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          // Add timeout to prevent hanging
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (!response.ok) {
          return new Response(
            JSON.stringify({
              error: `Failed to fetch Ollama models: ${response.status} ${response.statusText}`,
              baseUrl: ollamaUrl,
            }),
            {
              status: response.status,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        const data = await response.json();

        // Transform Ollama response to our format
        const models =
          data.models?.map((model: any) => ({
            name: model.name,
            model: model.model || model.name,
            size: model.size,
            digest: model.digest,
            modified_at: model.modified_at,
            details: model.details || {},
          })) || [];

        return new Response(JSON.stringify({ models, baseUrl: ollamaUrl }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error: any) {
        console.error("Error fetching Ollama models:", error);

        // Map known transport failures to safe, hardcoded messages. Never surface a
        // raw `error.message` — a Prisma or upstream error would stringify its
        // internals into the response (mirrors the #1515 disclosure fix).
        let errorMessage = "Failed to connect to Ollama server";
        if (error.name === "AbortError") {
          errorMessage = "Request timeout - Ollama server did not respond";
        } else if (error.code === "ECONNREFUSED") {
          errorMessage = "Connection refused - Ollama server is not running or not accessible";
        }

        return new Response(
          JSON.stringify({
            error: errorMessage,
            baseUrl,
            details: error.code || error.name || "Unknown error",
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    },
    { request },
  );
}
