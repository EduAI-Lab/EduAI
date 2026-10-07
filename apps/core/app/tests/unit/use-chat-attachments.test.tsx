// app/tests/unit/use-chat-attachments.test.tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { decodeTextDataUrl } from "~/lib/chat/chat-attachments";
import { useChatAttachments } from "~/components/chat/use-chat-attachments";

const file = (name: string) => new File(["x"], name);

describe("useChatAttachments", () => {
  it("goes pending → ready and exposes a text/plain attachment", async () => {
    const upload = vi.fn().mockResolvedValue({ text: "héllo", truncated: true });
    const { result } = renderHook(() => useChatAttachments({ upload }));

    act(() => result.current.add([file("a.py")]));
    expect(result.current.items[0]).toMatchObject({ name: "a.py", status: "pending" });
    expect(result.current.isBlocking).toBe(true);

    await waitFor(() => expect(result.current.items[0]?.status).toBe("ready"));
    expect(result.current.items[0]?.truncated).toBe(true);
    expect(result.current.isBlocking).toBe(false);
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0]).toMatchObject({
      name: "a.py",
      contentType: "text/plain",
    });
    expect(decodeTextDataUrl(result.current.attachments[0]!.url)).toBe("héllo");
  });

  it("marks a failed upload with the server sentence and blocks send", async () => {
    const upload = vi.fn().mockRejectedValue(new Error("This file has no readable text."));
    const { result } = renderHook(() => useChatAttachments({ upload }));
    act(() => result.current.add([file("scan.pdf")]));
    await waitFor(() => expect(result.current.items[0]?.status).toBe("failed"));
    expect(result.current.items[0]?.error).toBe("This file has no readable text.");
    expect(result.current.isBlocking).toBe(true);
  });

  it("rejects an unsupported extension without uploading", () => {
    const upload = vi.fn();
    const { result } = renderHook(() => useChatAttachments({ upload }));
    act(() => result.current.add([file("photo.png")]));
    expect(upload).not.toHaveBeenCalled();
    expect(result.current.items[0]).toMatchObject({ status: "failed" });
  });

  it("refuses a fourth file with a limit message", () => {
    const upload = vi.fn().mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useChatAttachments({ upload }));
    act(() => result.current.add([file("1.txt"), file("2.txt"), file("3.txt"), file("4.txt")]));
    expect(result.current.items).toHaveLength(3);
    expect(result.current.limitError).toMatch(/3 files/u);
  });

  it("remove drops the item; retry re-uploads a failed one; clear empties", async () => {
    const upload = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ text: "ok", truncated: false });
    const { result } = renderHook(() => useChatAttachments({ upload }));
    act(() => result.current.add([file("a.txt")]));
    await waitFor(() => expect(result.current.items[0]?.status).toBe("failed"));
    act(() => result.current.retry(result.current.items[0]!.id));
    await waitFor(() => expect(result.current.items[0]?.status).toBe("ready"));
    act(() => result.current.remove(result.current.items[0]!.id));
    expect(result.current.items).toHaveLength(0);
    act(() => result.current.add([file("b.txt")]));
    act(() => result.current.clear());
    expect(result.current.items).toHaveLength(0);
  });

  it("ignores a late upload result after the item was removed", async () => {
    let resolve!: (v: { text: string; truncated: boolean }) => void;
    const upload = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useChatAttachments({ upload }));
    act(() => result.current.add([file("a.txt")]));
    act(() => result.current.remove(result.current.items[0]!.id));
    await act(async () => resolve({ text: "late", truncated: false }));
    expect(result.current.items).toHaveLength(0);
  });
});
