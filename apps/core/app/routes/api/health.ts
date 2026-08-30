import { withErrorResponse } from "~/lib/errors.server";
export async function loader() {
  return withErrorResponse(async () => {
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }, {});
}
