import type { ActionFunctionArgs } from "react-router";
import { getServerConfiguredProviders } from "~/lib/ai/providers";

/**
 * POST /api/validate-api-key
 * Validates a user-provided API key by calling the provider's models endpoint.
 * 
 * Body: { provider: "openai" | "google", apiKey: string }
 * Response: { valid: boolean, error?: string }
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await request.json();
    const { provider, apiKey } = body;

    if (!provider || !apiKey) {
      return new Response(
        JSON.stringify({ valid: false, error: "Missing provider or apiKey" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (provider !== "openai" && provider !== "google") {
      return new Response(
        JSON.stringify({ valid: false, error: "Unsupported provider" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const result = await validateApiKey(provider, apiKey);
    return new Response(JSON.stringify(result), {
      status: result.valid ? 200 : 400,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("API key validation error:", error);
    return new Response(
      JSON.stringify({ valid: false, error: "Validation failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * GET /api/validate-api-key
 * Returns which providers have server-side keys configured.
 */
export async function loader() {
  const serverProviders = getServerConfiguredProviders();
  return new Response(JSON.stringify({ serverProviders }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function validateApiKey(
  provider: "openai" | "google",
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    if (provider === "openai") {
      const response = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (response.ok) {
        return { valid: true };
      }

      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData?.error?.message || `Invalid API key (${response.status})`;
      return { valid: false, error: errorMessage };
    }

    if (provider === "google") {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`,
        { method: "GET" }
      );

      if (response.ok) {
        return { valid: true };
      }

      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData?.error?.message || `Invalid API key (${response.status})`;
      return { valid: false, error: errorMessage };
    }

    return { valid: false, error: "Unsupported provider" };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}
