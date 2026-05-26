import type { ActionFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { isRateLimited } from "~/lib/auth/rate-limit.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  if (isRateLimited(ip)) {
    return new Response(JSON.stringify({ error: "Too Many Requests" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  const session = await auth.api.getSession(request);

  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { id, email, name, image, role } = session.user;

  return new Response(
    JSON.stringify({
      user: { id, email, name, image, role: role ?? "STUDENT" },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}
