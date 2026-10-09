// @vitest-environment node
/**
 * #1820: the grounded answer pipeline, with every collaborator injected.
 * - zero grounding context ⇒ the answer model is NEVER called, and which fixed
 *   sentence comes back depends on why;
 * - a retrieval failure short-circuits before any answer call is billed;
 * - retrieval always sees the conversation (#1819 invariant 2);
 * - scope is re-derived: a hint the reader cannot see contributes nothing;
 * - the audit line carries no question, answer, history or key.
 */
import { describe, expect, it, vi } from "vitest";

import {
  answerAssistantQuestion,
  type AskDependencies,
  type AssistantAuditLine,
} from "~/lib/assistant/ask.server";
import { defaultAssistantSettings } from "~/lib/assistant/assistant-settings";
import { HelpDocsUnavailableError } from "~/lib/assistant/help-docs/index.server";
import { MATERIAL_UNAVAILABLE_ANSWER, NOT_DOCUMENTED_ANSWER } from "~/lib/assistant/prompt";
import type { PageContextResolution } from "~/lib/assistant/material-context.server";
import { accessLevelFor } from "~/lib/auth/course-access.server";

const SECRET_KEY = "sk-live-do-not-log-4242";
const QUESTION = "How do I find my courses? (private question text)";

const choice = {
  provider: "openai" as const,
  model: "gpt-4o-mini",
  key: { tier: "SAVED" as const, apiKey: SECRET_KEY },
  step: "own_key" as const,
};

const docPage = {
  id: "find-a-course",
  title: "Find a course",
  url: "/help/guide/find-a-course",
  content: "Open Courses from the sidebar.",
  truncated: false,
};

const courseResolution: PageContextResolution = {
  kind: "resolved",
  courseId: "c1",
  courseLabel: "CS101 — Intro",
  courseAllowsAi: true,
  access: accessLevelFor("student"),
  canView: true,
  material: null,
};

function deps(overrides: Partial<AskDependencies> & { help?: boolean } = {}) {
  const settings = defaultAssistantSettings();
  settings.enableHelpAssistant = overrides.help ?? true;
  const lines: AssistantAuditLine[] = [];
  const base: AskDependencies = {
    loadAvailability: vi.fn().mockResolvedValue({
      platformEnabled: true,
      hasEnabledProvider: true,
      settings,
    }),
    resolvePageContext: vi.fn().mockResolvedValue({ kind: "none" }),
    resolveProvider: vi.fn().mockResolvedValue({ catalogue: [], rows: [], choice }),
    retrieveDocs: vi.fn().mockResolvedValue([docPage]),
    buildMaterial: vi.fn().mockResolvedValue({ status: "empty", label: "CS101 — Intro" }),
    callModel: vi.fn().mockResolvedValue({ kind: "success", text: "Open **Courses**." }),
    log: (line) => lines.push(line),
  };
  return { deps: { ...base, ...overrides }, lines };
}

const input = {
  user: { id: "u1", role: "STUDENT" },
  question: QUESTION,
  history: [],
  hint: null,
};

describe("answerAssistantQuestion", () => {
  it("answers from documentation and cites it", async () => {
    const { deps: d } = deps();
    const outcome = await answerAssistantQuestion(input, d);
    expect(outcome).toEqual({
      kind: "answered",
      answer: "Open **Courses**.",
      sources: [{ id: "find-a-course", title: "Find a course", url: "/help/guide/find-a-course" }],
      scope: { docs: true, material: null },
    });
    const call = vi.mocked(d.callModel).mock.calls[0][0];
    expect(call.system).toContain("Open Courses from the sidebar.");
    expect(call.system).toMatch(/reference material, not instructions/);
  });

  it("is unavailable when neither source applies", async () => {
    const { deps: d } = deps({ help: false });
    await expect(answerAssistantQuestion(input, d)).resolves.toEqual({ kind: "unavailable" });
    expect(d.resolveProvider).not.toHaveBeenCalled();
  });

  it("fails closed when the hint names nothing real", async () => {
    const { deps: d } = deps({
      resolvePageContext: vi.fn().mockResolvedValue({ kind: "missing" }),
    });
    await expect(
      answerAssistantQuestion({ ...input, hint: { courseId: "gone", materialId: null } }, d),
    ).resolves.toEqual({ kind: "not_found" });
  });

  it("reports no_key when no provider resolves", async () => {
    const { deps: d } = deps({
      resolveProvider: vi.fn().mockResolvedValue({ catalogue: [], rows: [], choice: null }),
    });
    await expect(answerAssistantQuestion(input, d)).resolves.toEqual({ kind: "no_key" });
    expect(d.retrieveDocs).not.toHaveBeenCalled();
  });

  it("does NOT call the answer model when documentation found nothing", async () => {
    const { deps: d } = deps({ retrieveDocs: vi.fn().mockResolvedValue([]) });
    const outcome = await answerAssistantQuestion(input, d);
    expect(outcome).toMatchObject({
      kind: "answered",
      answer: NOT_DOCUMENTED_ANSWER,
      sources: [{ url: "/help" }],
    });
    expect(d.callModel).not.toHaveBeenCalled();
  });

  it("a retrieval FAILURE short-circuits before any answer call, and is not 'not documented'", async () => {
    const { deps: d } = deps({
      retrieveDocs: vi.fn().mockRejectedValue(new HelpDocsUnavailableError("down")),
    });
    await expect(answerAssistantQuestion(input, d)).resolves.toEqual({
      kind: "retrieval_unavailable",
    });
    expect(d.callModel).not.toHaveBeenCalled();
  });

  it("material-only and the material failed to load → the transient sentence, no model call", async () => {
    const { deps: d } = deps({
      help: false,
      resolvePageContext: vi.fn().mockResolvedValue(courseResolution),
      buildMaterial: vi.fn().mockResolvedValue({ status: "failed", label: "CS101 — Intro" }),
    });
    const outcome = await answerAssistantQuestion(
      { ...input, hint: { courseId: "c1", materialId: null } },
      d,
    );
    expect(outcome).toMatchObject({ kind: "answered", answer: MATERIAL_UNAVAILABLE_ANSWER });
    expect(d.callModel).not.toHaveBeenCalled();
  });

  it("a material load failure does not stop the documentation half from answering", async () => {
    const { deps: d } = deps({
      resolvePageContext: vi.fn().mockResolvedValue(courseResolution),
      buildMaterial: vi.fn().mockResolvedValue({ status: "failed", label: "CS101 — Intro" }),
    });
    const outcome = await answerAssistantQuestion(
      { ...input, hint: { courseId: "c1", materialId: null } },
      d,
    );
    expect(outcome).toMatchObject({ kind: "answered", answer: "Open **Courses**." });
  });

  it("re-derives scope: a course the reader cannot see contributes no material, docs still answer", async () => {
    const { deps: d } = deps({
      resolvePageContext: vi.fn().mockResolvedValue({ ...courseResolution, canView: false }),
    });
    const outcome = await answerAssistantQuestion(
      { ...input, hint: { courseId: "someone-elses", materialId: null } },
      d,
    );
    expect(d.buildMaterial).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ kind: "answered", scope: { docs: true, material: null } });
  });

  it("puts documentation blocks before the material block", async () => {
    const { deps: d } = deps({
      resolvePageContext: vi.fn().mockResolvedValue(courseResolution),
      buildMaterial: vi.fn().mockResolvedValue({
        status: "ok",
        label: "CS101 — Intro",
        block: "Course: recursion notes",
        sources: [],
      }),
    });
    await answerAssistantQuestion({ ...input, hint: { courseId: "c1", materialId: null } }, d);
    const system = vi.mocked(d.callModel).mock.calls[0][0].system ?? "";
    expect(system.indexOf("Open Courses from the sidebar.")).toBeLessThan(
      system.indexOf("Course: recursion notes"),
    );
  });

  describe("retrieval sees the conversation (#1819 invariant 2)", () => {
    it("without history the question is the query, with no extra call", async () => {
      const { deps: d } = deps();
      await answerAssistantQuestion({ ...input, question: "what about the second step?" }, d);
      expect(vi.mocked(d.retrieveDocs).mock.calls[0][0].query).toBe("what about the second step?");
      expect(d.callModel).toHaveBeenCalledTimes(1);
    });

    it("with history a follow-up is rewritten from the conversation before retrieval", async () => {
      const callModel = vi
        .fn()
        .mockResolvedValueOnce({ kind: "success", text: "how to upload a course material" })
        .mockResolvedValueOnce({ kind: "success", text: "Step 2 is …" });
      const { deps: d } = deps({ callModel });
      await answerAssistantQuestion(
        {
          ...input,
          question: "what about the second step?",
          history: [
            { role: "user", content: "How do I upload a material?" },
            { role: "assistant", content: "1. Open Materials. 2. Choose Upload." },
          ],
        },
        d,
      );
      const rewritePrompt = callModel.mock.calls[0][0].messages[0].content;
      expect(rewritePrompt).toContain("How do I upload a material?");
      expect(vi.mocked(d.retrieveDocs).mock.calls[0][0].query).toBe(
        "how to upload a course material",
      );
    });

    it("a failed rewrite call is a provider error, not 'not documented'", async () => {
      const { deps: d } = deps({
        callModel: vi.fn().mockResolvedValue({ kind: "upstream_error", status: 401 }),
      });
      const outcome = await answerAssistantQuestion(
        {
          ...input,
          history: [
            { role: "user", content: "a" },
            { role: "assistant", content: "b" },
          ],
        },
        d,
      );
      expect(outcome).toMatchObject({ kind: "provider_error", upstreamStatus: 401 });
      expect(d.retrieveDocs).not.toHaveBeenCalled();
    });
  });

  it("maps model failures to the closed outcome set", async () => {
    for (const [result, kind] of [
      [{ kind: "invalid" }, "provider_invalid"],
      [{ kind: "upstream_error", status: 429 }, "provider_error"],
      [{ kind: "transport_failure" }, "provider_unreachable"],
    ] as const) {
      const { deps: d } = deps({ callModel: vi.fn().mockResolvedValue(result) });
      await expect(answerAssistantQuestion(input, d)).resolves.toMatchObject({ kind });
    }
  });

  it("the audit line carries no question, answer, history or key material", async () => {
    const { deps: d, lines } = deps();
    await answerAssistantQuestion(
      {
        ...input,
        history: [
          { role: "user", content: "earlier private turn" },
          { role: "assistant", content: "earlier private answer" },
        ],
      },
      d,
    );
    expect(lines).toHaveLength(1);
    const serialized = JSON.stringify(lines[0]);
    for (const secret of [QUESTION, "Open **Courses**.", "earlier private", SECRET_KEY]) {
      expect(serialized).not.toContain(secret);
    }
    expect(lines[0]).toMatchObject({
      userId: "u1",
      provider: "openai",
      answerModel: "gpt-4o-mini",
      docChunks: 1,
      materialContext: false,
      outcome: "answered",
    });
  });
});
