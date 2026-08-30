/**
 * Unit tests for `questionBankService` (#1546): CRUD + membership client for
 * per-course question banks.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();

vi.mock("../../services/api", () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
    delete: (...args: unknown[]) => del(...args),
  },
}));

import { questionBankService } from "../../services/questionBankService";

afterEach(() => {
  vi.clearAllMocks();
});

describe("questionBankService", () => {
  it("listBanks returns the data array", async () => {
    get.mockResolvedValue({ data: { data: [{ id: "b1" }] } });
    const banks = await questionBankService.listBanks(1);
    expect(get).toHaveBeenCalledWith("/api/course/1/banks");
    expect(banks).toEqual([{ id: "b1" }]);
  });

  it("listBanks falls back to an empty array when data is missing", async () => {
    get.mockResolvedValue({ data: {} });
    const banks = await questionBankService.listBanks(1);
    expect(banks).toEqual([]);
  });

  it("createBank posts the payload and returns the created bank", async () => {
    post.mockResolvedValue({ data: { data: { id: "b2", name: "New" } } });
    const bank = await questionBankService.createBank(1, { name: "New" });
    expect(post).toHaveBeenCalledWith("/api/course/1/banks", { name: "New" });
    expect(bank).toEqual({ id: "b2", name: "New" });
  });

  it("updateBank puts the payload and returns the updated bank", async () => {
    put.mockResolvedValue({ data: { data: { id: "b2", name: "Renamed" } } });
    const bank = await questionBankService.updateBank(1, "b2", { name: "Renamed" });
    expect(put).toHaveBeenCalledWith("/api/course/1/banks/b2", { name: "Renamed" });
    expect(bank).toEqual({ id: "b2", name: "Renamed" });
  });

  it("deleteBank deletes without a body when no target bank is given", async () => {
    del.mockResolvedValue({});
    await questionBankService.deleteBank(1, "b2");
    expect(del).toHaveBeenCalledWith("/api/course/1/banks/b2", { data: undefined });
  });

  it("deleteBank forwards moveMembershipsToBankId in the request body", async () => {
    del.mockResolvedValue({});
    await questionBankService.deleteBank(1, "b2", "b3");
    expect(del).toHaveBeenCalledWith("/api/course/1/banks/b2", {
      data: { moveMembershipsToBankId: "b3" },
    });
  });

  it("addQuestionToBank posts the question metadata id", async () => {
    post.mockResolvedValue({});
    await questionBankService.addQuestionToBank(1, "b2", 99);
    expect(post).toHaveBeenCalledWith("/api/course/1/banks/b2/questions", {
      questionMetadataId: 99,
    });
  });

  it("removeQuestionFromBank deletes the membership by id", async () => {
    del.mockResolvedValue({});
    await questionBankService.removeQuestionFromBank(1, "b2", 99);
    expect(del).toHaveBeenCalledWith("/api/course/1/banks/b2/questions/99");
  });
});
