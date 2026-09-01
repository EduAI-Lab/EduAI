// @vitest-environment node
// #1213 — GET /api/disciplines delegates entirely to listDisciplines (§541).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/disciplines/server", () => ({
  listDisciplines: vi.fn(),
}));

import { loader } from "~/routes/api/disciplines";
import { listDisciplines } from "~/lib/disciplines/server";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/disciplines", () => {
  it("delegates to listDisciplines with the request", async () => {
    const response = new Response(JSON.stringify([{ code: "COSC", name: "Computer Science" }]));
    vi.mocked(listDisciplines).mockResolvedValue(response as never);

    const request = new Request("http://localhost/api/disciplines");
    const res = await loader({ request, params: {}, context: {} as never } as never);
    expect(res).toBe(response);
    expect(listDisciplines).toHaveBeenCalledWith(request);
  });
});
