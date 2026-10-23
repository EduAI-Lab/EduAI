/**
 * #1958: Penny inside an extension. The gate comes from Core cross-origin; any
 * answer other than "on" renders nothing, and asks, citations and course scope
 * all point at Core.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ExtensionHelpAssistant,
  resetAssistantStoreForTests,
  type AssistantGateResponse,
  type ThreadSource,
} from "../assistant";

type AskBody = {
  answer: string;
  sources: ThreadSource[];
  scope: { docs: boolean; material: string | null };
};

const CORE = "https://core.example";
const fetchMock = vi.fn();

function json(body: AssistantGateResponse | AskBody | { error: string }, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function gate(overrides: Partial<AssistantGateResponse> = {}) {
  return json({
    gate: { mounted: true, docs: true },
    user: { id: "u1", role: "INSTRUCTOR" },
    context: null,
    ...overrides,
  });
}

function renderAssistant(props: Partial<Parameters<typeof ExtensionHelpAssistant>[0]> = {}) {
  return render(
    <ExtensionHelpAssistant
      coreUrl={`${CORE}/`}
      coreCourseId={null}
      placement="floating"
      {...props}
    />,
  );
}

const bubbleName = /Ask Penny, the help assistant/;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  resetAssistantStoreForTests();
  vi.unstubAllGlobals();
});

describe("ExtensionHelpAssistant", () => {
  it("renders the bubble when Core says the assistant is on", async () => {
    fetchMock.mockResolvedValueOnce(gate());
    renderAssistant();
    expect(await screen.findByRole("button", { name: bubbleName })).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CORE}/api/assistant/gate`);
    expect(init).toMatchObject({ credentials: "include", method: "GET" });
  });

  it("renders nothing when the assistant is off", async () => {
    fetchMock.mockResolvedValueOnce(gate({ gate: { mounted: false, docs: false } }));
    const { container } = renderAssistant();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: bubbleName })).toBeNull();
  });

  it("renders nothing without a Core session", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "Unauthorized" }, 401));
    const { container } = renderAssistant();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when Core can't be reached", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { container } = renderAssistant();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("asks Core with the course hint Core granted, and cites Core pages in a new tab", async () => {
    fetchMock.mockResolvedValueOnce(
      gate({
        context: { courseId: "c1", materialId: null, label: "CS101 — Intro", materialScope: true },
      }),
    );
    renderAssistant({ coreCourseId: "c1" });
    expect(fetchMock.mock.calls[0][0]).toBe(`${CORE}/api/assistant/gate?courseId=c1`);

    fireEvent.click(await screen.findByRole("button", { name: bubbleName }));
    expect(screen.getByText("CS101 — Intro", { selector: "span[title]" })).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(
      json({
        answer: "Open **Materials**.",
        sources: [{ id: "upload", title: "Uploading materials", url: "/help/guide/materials" }],
        scope: { docs: true, material: "CS101 — Intro" },
      }),
    );
    const input = screen.getByRole("textbox", { name: /Ask Penny a question/ });
    fireEvent.change(input, { target: { value: "How do I upload?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));

    const link = await screen.findByRole("link", { name: /Uploading materials/ });
    expect(link).toHaveAttribute("href", `${CORE}/help/guide/materials`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");

    const [askUrl, askInit] = fetchMock.mock.calls[1];
    expect(askUrl).toBe(`${CORE}/api/assistant/ask`);
    expect(askInit.credentials).toBe("include");
    expect(JSON.parse(askInit.body)).toMatchObject({
      question: "How do I upload?",
      context: { courseId: "c1" },
    });
  });

  it("sends no course hint when Core denied material scope", async () => {
    fetchMock.mockResolvedValueOnce(
      gate({
        context: { courseId: "c1", materialId: null, label: "CS101 — Intro", materialScope: false },
      }),
    );
    renderAssistant({ coreCourseId: "c1" });
    fireEvent.click(await screen.findByRole("button", { name: bubbleName }));
    fetchMock.mockResolvedValueOnce(
      json({ answer: "Not covered.", sources: [], scope: { docs: true, material: null } }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: /Ask Penny a question/ }), {
      target: { value: "Hi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    await screen.findByText("Not covered.");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).context).toBeNull();
  });

  it("uses a header button instead of the bubble on chat screens", async () => {
    fetchMock.mockResolvedValueOnce(gate());
    renderAssistant({ placement: "header" });
    const button = await screen.findByRole("button", { name: bubbleName });
    expect(button).toHaveTextContent("Ask Penny");
    expect(screen.getAllByRole("button", { name: bubbleName })).toHaveLength(1);
  });

  it("re-reads the gate when the page's course changes", async () => {
    fetchMock.mockImplementation(async () => gate());
    const { rerender } = renderAssistant({ coreCourseId: "c1" });
    await screen.findByRole("button", { name: bubbleName });
    rerender(<ExtensionHelpAssistant coreUrl={CORE} coreCourseId="c2" placement="floating" />);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        `${CORE}/api/assistant/gate?courseId=c2`,
        expect.anything(),
      ),
    );
  });

  it("retries a failed gate read instead of hiding Penny until reload", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fetchMock.mockResolvedValueOnce(json({ error: "Too many requests" }, 429));
      fetchMock.mockResolvedValueOnce(gate());
      renderAssistant();
      await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      expect(screen.queryByRole("button", { name: bubbleName })).toBeNull();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await screen.findByRole("button", { name: bubbleName })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-reads the gate when the tab becomes visible again", async () => {
    fetchMock.mockImplementation(async () => gate());
    renderAssistant();
    await screen.findByRole("button", { name: bubbleName });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("links to Core for settings instead of editing them cross-origin", async () => {
    fetchMock.mockResolvedValueOnce(gate());
    renderAssistant();
    fireEvent.click(await screen.findByRole("button", { name: bubbleName }));
    fireEvent.click(screen.getByRole("button", { name: "Assistant settings" }));
    const link = screen.getByRole("link", { name: "Open EduAI Core" });
    expect(link).toHaveAttribute("href", CORE);
    expect(link).toHaveAttribute("target", "_blank");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
