/**
 * #1822 component tests for the help assistant widget:
 * - an answer containing `<script>` / `<img onerror>` renders as visible text;
 * - a cited `javascript:` URL never becomes an href;
 * - the gate's loader data decides whether anything renders at all;
 * - mounted-but-hidden never shifts the toast stack;
 * - keyboard-only: open, type, submit, read the answer, Escape to close;
 * - switching material starts a new thread and updates the header label;
 * - on chat screens the bubble gives way to a header button.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const rootData = vi.hoisted(() => ({
  current: { assistant: { mounted: true, docs: true } } as
    | { assistant: { mounted: boolean; docs: boolean } }
    | undefined,
}));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useRouteLoaderData: () => rootData.current,
}));

import {
  AssistantHeaderButton,
  BUBBLE_VISIBLE_ATTRIBUTE,
  HelpAssistant,
} from "~/components/assistant/help-assistant";
import { publishAssistantContext } from "~/components/assistant/assistant-events";
import { resetAssistantStoreForTests } from "~/components/assistant/assistant-store";
import type { RouteRequestBody } from "../helpers/route-fixtures";

const user = { id: "u1", role: "STUDENT" };

function answer(body: RouteRequestBody) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn();

function renderAt(path = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AssistantHeaderButton />
      <HelpAssistant user={user} />
    </MemoryRouter>,
  );
}

function bubble() {
  return screen.getByRole("button", { name: /Ask Penny, the help assistant/ });
}

async function openAndAsk(question: string) {
  fireEvent.click(bubble());
  const input = await screen.findByRole("textbox", { name: /Ask Penny a question/ });
  fireEvent.change(input, { target: { value: question } });
  fireEvent.keyDown(input, { key: "Enter" });
}

beforeEach(() => {
  rootData.current = { assistant: { mounted: true, docs: true } };
  resetAssistantStoreForTests();
  window.sessionStorage.clear();
  act(() => publishAssistantContext(null));
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute(BUBBLE_VISIBLE_ATTRIBUTE);
});

describe("XSS-safe rendering", () => {
  it("renders markup in an answer as inert visible text", async () => {
    fetchMock.mockResolvedValue(
      answer({
        answer:
          'Try this: <script>window.__pwned = 1</script> <img src=x onerror="window.__pwned=2">',
        sources: [],
        scope: { docs: true, material: null },
      }),
    );
    renderAt();
    await openAndAsk("hello");

    const log = screen.getByRole("log");
    await within(log).findByText(/<script>window.__pwned = 1<\/script>/);
    expect(log.querySelector("script")).toBeNull();
    expect(log.querySelector("img")).toBeNull();
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("never turns a javascript: source URL into an href", async () => {
    fetchMock.mockResolvedValue(
      answer({
        answer: "See the guide.",
        sources: [
          { id: "evil", title: "Evil source", url: "javascript:alert(1)" },
          { id: "find-a-course", title: "Find a course", url: "/help/guide/find-a-course" },
        ],
        scope: { docs: true, material: null },
      }),
    );
    renderAt();
    await openAndAsk("hello");

    const evil = await screen.findByText("Evil source");
    expect(evil.closest("a")).toBeNull();
    expect(screen.getByText("Find a course").closest("a")?.getAttribute("href")).toBe(
      "/help/guide/find-a-course",
    );
  });
});

describe("render condition and visibility", () => {
  it("renders nothing at all for a user the gate excludes (from the loader data)", () => {
    rootData.current = { assistant: { mounted: false, docs: false } };
    const { container } = renderAt();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a signed-out page with no assistant loader data", () => {
    rootData.current = undefined;
    const { container } = renderAt();
    expect(container).toBeEmptyDOMElement();
  });

  it("mounted but hidden: no bubble, and the toast stack is not shifted", () => {
    rootData.current = { assistant: { mounted: true, docs: false } };
    renderAt();
    expect(screen.queryByRole("button", { name: /Penny/ })).toBeNull();
    expect(document.documentElement.hasAttribute(BUBBLE_VISIBLE_ATTRIBUTE)).toBe(false);
  });

  it("a page publishing material scope makes the material-only assistant visible", () => {
    rootData.current = { assistant: { mounted: true, docs: false } };
    renderAt("/courses/c1");
    act(() =>
      publishAssistantContext({
        courseId: "c1",
        materialId: null,
        label: "CS101 — Intro",
        materialScope: true,
      }),
    );
    expect(bubble()).toBeInTheDocument();
    expect(document.documentElement.getAttribute(BUBBLE_VISIBLE_ATTRIBUTE)).toBe("visible");
  });

  it("on a chat screen the bubble gives way to a header button, and toasts stay put", () => {
    renderAt("/chat");
    expect(
      screen.queryByRole("button", { name: "Ask Penny, the help assistant" }),
    ).toBeInTheDocument();
    expect(document.querySelector(".fixed.rounded-full")).toBeNull();
    expect(document.documentElement.hasAttribute(BUBBLE_VISIBLE_ATTRIBUTE)).toBe(false);
  });
});

describe("keyboard-only walkthrough", () => {
  it("opens, takes a question, shows the answer in the live log, and closes on Escape", async () => {
    fetchMock.mockResolvedValue(
      answer({
        answer: "1. Open **Courses**.\n2. Pick a course.",
        sources: [
          { id: "find-a-course", title: "Find a course", url: "/help/guide/find-a-course" },
        ],
        scope: { docs: true, material: null },
      }),
    );
    renderAt();

    const toggle = bubble();
    expect(toggle).toHaveAttribute("aria-haspopup", "dialog");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    toggle.focus();
    fireEvent.click(toggle); // Enter/Space on a native button activates it as a click.

    const input = await screen.findByRole("textbox", { name: /Ask Penny a question/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(document.activeElement).toBe(input));

    fireEvent.change(input, { target: { value: "How do I find my courses?" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const log = screen.getByRole("log");
    expect(log).toHaveAttribute("aria-live", "polite");
    await within(log).findByText("Courses");
    expect(log.querySelectorAll("ol > li")).toHaveLength(2);

    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request).toEqual({ question: "How do I find my courses?", history: [], context: null });
    expect(request).not.toHaveProperty("apiKey");

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(bubble());
  });

  it("resends only answered exchanges as history", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "down", code: "retrieval_unavailable" }), {
          status: 503,
        }),
      )
      .mockResolvedValueOnce(
        answer({ answer: "First answer", sources: [], scope: { docs: true, material: null } }),
      )
      .mockResolvedValueOnce(
        answer({ answer: "Second answer", sources: [], scope: { docs: true, material: null } }),
      );
    renderAt();
    await openAndAsk("q1");
    await screen.findByText("down");

    const input = screen.getByRole("textbox", { name: /Ask Penny a question/ });
    fireEvent.change(input, { target: { value: "q2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("First answer");

    fireEvent.change(input, { target: { value: "q3" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Second answer");

    const third = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(third.history).toEqual([
      { role: "user", content: "q2" },
      { role: "assistant", content: "First answer" },
    ]);
  });
});

describe("threads are bound to scope", () => {
  it("switching material starts a new thread and updates the header label", async () => {
    fetchMock.mockResolvedValue(
      answer({ answer: "About notes A", sources: [], scope: { docs: true, material: "Notes A" } }),
    );
    renderAt("/courses/c1");
    act(() =>
      publishAssistantContext({
        courseId: "c1",
        materialId: "m1",
        label: "Notes A",
        materialScope: true,
      }),
    );
    await openAndAsk("what is in this?");
    await screen.findByText("About notes A");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Notes A")).toBeInTheDocument();

    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.context).toEqual({ courseId: "c1", materialId: "m1" });

    act(() =>
      publishAssistantContext({
        courseId: "c1",
        materialId: "m2",
        label: "Notes B",
        materialScope: true,
      }),
    );
    expect(within(screen.getByRole("dialog")).getByText("Notes B")).toBeInTheDocument();
    expect(screen.queryByText("About notes A")).toBeNull();
    expect(screen.getByText(/Hi, I'm Penny/)).toBeInTheDocument();

    // Back to the first material: its thread is still there.
    act(() =>
      publishAssistantContext({
        courseId: "c1",
        materialId: "m1",
        label: "Notes A",
        materialScope: true,
      }),
    );
    expect(screen.getByText("About notes A")).toBeInTheDocument();
  });

  it("does not send a course hint when the server did not grant material scope", async () => {
    fetchMock.mockResolvedValue(
      answer({ answer: "ok", sources: [], scope: { docs: true, material: null } }),
    );
    renderAt("/courses/c1");
    act(() =>
      publishAssistantContext({
        courseId: "c1",
        materialId: null,
        label: "CS101",
        materialScope: false,
      }),
    );
    await openAndAsk("q");
    await screen.findByText("ok");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).context).toBeNull();
    expect(within(screen.getByRole("dialog")).getByText("Help with EduAI")).toBeInTheDocument();
  });
});
