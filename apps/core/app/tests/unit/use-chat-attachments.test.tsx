// app/tests/unit/use-chat-attachments.test.tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeTextDataUrl } from "~/lib/chat/chat-attachments";
import {
  filesFromPaste,
  uploadChatAttachment,
  useChatAttachments,
} from "~/components/chat/use-chat-attachments";

const file = (name: string) => new File(["x"], name);

/** Just the parts of a clipboard `filesFromPaste` reads. */
function clipboard(files: File[], text: Record<string, string> = {}): DataTransfer {
  const types = [...Object.keys(text), ...(files.length > 0 ? ["Files"] : [])];
  // SAFETY: test double for the three DataTransfer members the code reads.
  return { files, types, getData: (type: string) => text[type] ?? "" } as unknown as DataTransfer;
}

const screenshot = () => new File(["png"], "image.png", { type: "image/png" });
const pastedFiles = (data: DataTransfer, soFar: number) => filesFromPaste(data, soFar).files;

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
    expect(result.current.items[0]?.retryable).toBe(true);
    expect(result.current.isBlocking).toBe(true);
  });

  it("rejects an unsupported extension without uploading", () => {
    const upload = vi.fn();
    const { result } = renderHook(() => useChatAttachments({ upload }));
    act(() => result.current.add([file("animation.gif")]));
    expect(upload).not.toHaveBeenCalled();
    expect(result.current.items[0]).toMatchObject({ status: "failed", retryable: false });
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
    expect(upload).toHaveBeenCalledTimes(2);
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
    const id = result.current.items[0]!.id;
    act(() => result.current.remove(id));
    await act(async () => resolve({ text: "late", truncated: false }));
    expect(result.current.items).toHaveLength(0);
    expect(upload).toHaveBeenCalledTimes(1);
    act(() => result.current.retry(id));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(result.current.items).toHaveLength(0);
  });

  it("does not re-upload a pending item on retry", () => {
    const upload = vi.fn().mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useChatAttachments({ upload }));
    act(() => result.current.add([file("a.txt")]));
    act(() => result.current.retry(result.current.items[0]!.id));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("does not re-upload a ready item on retry", async () => {
    const upload = vi.fn().mockResolvedValue({ text: "ok", truncated: false });
    const { result } = renderHook(() => useChatAttachments({ upload }));
    act(() => result.current.add([file("a.txt")]));
    await waitFor(() => expect(result.current.items[0]?.status).toBe("ready"));
    act(() => result.current.retry(result.current.items[0]!.id));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("retry on an unsupported file is a no-op", () => {
    const upload = vi.fn();
    const { result } = renderHook(() => useChatAttachments({ upload }));
    act(() => result.current.add([file("animation.gif")]));
    act(() => result.current.retry(result.current.items[0]!.id));
    expect(upload).not.toHaveBeenCalled();
    expect(result.current.items[0]?.status).toBe("failed");
  });
});

describe("uploadChatAttachment", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps a rejected fetch to a friendly sentence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(uploadChatAttachment(file("a.txt"))).rejects.toThrow(
      "Couldn't upload this file. Check your connection and try again.",
    );
  });

  it("uses the fallback sentence for a non-JSON 500", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 500 })));
    await expect(uploadChatAttachment(file("a.txt"))).rejects.toThrow(
      "We couldn't read this file. Try again, or attach a different copy.",
    );
  });

  it("surfaces the server sentence on a 422", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "No readable text.", code: "X" }), { status: 422 }),
        ),
    );
    await expect(uploadChatAttachment(file("a.txt"))).rejects.toThrow("No readable text.");
  });
});

describe("filesFromPaste (#1742)", () => {
  it("attaches a pasted screenshot under a numbered name", () => {
    const [pasted] = pastedFiles(clipboard([screenshot()]), 0);
    expect(pasted?.name).toBe("Pasted image 1.png");
    expect(pasted?.type).toBe("image/png");
  });

  it("numbers on from the images already pasted", () => {
    const pasted = pastedFiles(clipboard([screenshot(), screenshot()]), 2);
    expect(pasted.map((f) => f.name)).toEqual(["Pasted image 3.png", "Pasted image 4.png"]);
  });

  it("uses the extension of the pasted type", () => {
    const jpeg = new File(["j"], "image.jpeg", { type: "image/jpeg" });
    expect(pastedFiles(clipboard([jpeg]), 0)[0]?.name).toBe("Pasted image 1.jpg");
  });

  it("keeps the real name of a file copied in Finder", () => {
    const copied = new File(["p"], "lab3-output.png", { type: "image/png" });
    const notes = new File(["n"], "notes.pdf", { type: "application/pdf" });
    const pasted = pastedFiles(clipboard([copied, notes], { "text/plain": "lab3-output.png" }), 0);
    expect(pasted.map((f) => f.name)).toEqual(["lab3-output.png", "notes.pdf"]);
  });

  it("lets cells copied from Excel or Word paste as text, not as their picture", () => {
    const data = clipboard([screenshot()], { "text/plain": "a\tb", "text/html": "<table>" });
    expect(pastedFiles(data, 0)).toEqual([]);
  });

  it('attaches a web page\'s "Copy image", which carries HTML but no text', () => {
    const data = clipboard([screenshot()], { "text/html": '<img src="x">' });
    expect(pastedFiles(data, 0)).toHaveLength(1);
  });

  it("leaves a plain text paste alone", () => {
    expect(pastedFiles(clipboard([], { "text/plain": "hello" }), 0)).toEqual([]);
  });

  it("reports which files it renamed", () => {
    const copied = new File(["p"], "Pasted image 9.png", { type: "image/png" });
    expect(filesFromPaste(clipboard([screenshot(), copied]), 0).renamed).toEqual([true, false]);
  });

  it("keeps an unsupported image's name so its chip says why", () => {
    const gif = new File(["g"], "image.gif", { type: "image/gif" });
    expect(pastedFiles(clipboard([gif]), 0)[0]?.name).toBe("image.gif");
  });
});

describe("useChatAttachments paste (#1742)", () => {
  it("uploads a pasted screenshot and reports the paste as taken", () => {
    const upload = vi.fn().mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useChatAttachments({ upload }));
    let taken = false;
    act(() => {
      taken = result.current.paste(clipboard([screenshot()]));
    });
    expect(taken).toBe(true);
    expect(upload).toHaveBeenCalledOnce();
    expect(result.current.items[0]).toMatchObject({
      name: "Pasted image 1.png",
      status: "pending",
    });
  });

  it("keeps counting across pastes", () => {
    const upload = vi.fn().mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useChatAttachments({ upload }));
    act(() => void result.current.paste(clipboard([screenshot()])));
    act(() => void result.current.paste(clipboard([screenshot()])));
    expect(result.current.items.map((i) => i.name)).toEqual([
      "Pasted image 1.png",
      "Pasted image 2.png",
    ]);
  });

  it("returns false for a text paste so the textbox gets it", () => {
    const upload = vi.fn();
    const { result } = renderHook(() => useChatAttachments({ upload }));
    let taken = true;
    act(() => {
      taken = result.current.paste(clipboard([], { "text/plain": "hello" }));
    });
    expect(taken).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  // #1990 review: numbering restarts with each message and has no gaps.
  it("restarts numbering after the message is sent", () => {
    const upload = vi.fn().mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useChatAttachments({ upload }));
    act(() => void result.current.paste(clipboard([screenshot()])));
    act(() => result.current.clear());
    act(() => void result.current.paste(clipboard([screenshot()])));
    expect(result.current.items.map((i) => i.name)).toEqual(["Pasted image 1.png"]);
  });

  it("uses no number for a screenshot the file limit refused", () => {
    const upload = vi.fn().mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useChatAttachments({ upload }));
    act(() => result.current.add([file("a.txt"), file("b.txt")]));
    act(() => void result.current.paste(clipboard([screenshot(), screenshot()])));
    expect(result.current.limitError).toMatch(/up to 3 files/u);
    act(() => result.current.remove(result.current.items[0]!.id));
    act(() => void result.current.paste(clipboard([screenshot()])));
    expect(result.current.items.map((i) => i.name)).toEqual([
      "b.txt",
      "Pasted image 1.png",
      "Pasted image 2.png",
    ]);
  });

  it('does not count a real file already named "Pasted image"', () => {
    const upload = vi.fn().mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useChatAttachments({ upload }));
    const named = new File(["p"], "Pasted image 7.png", { type: "image/png" });
    act(() => void result.current.paste(clipboard([named])));
    act(() => void result.current.paste(clipboard([screenshot()])));
    expect(result.current.items.map((i) => i.name)).toEqual([
      "Pasted image 7.png",
      "Pasted image 1.png",
    ]);
  });
});
