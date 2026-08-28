// @vitest-environment node
//
// #1665 review: chat-admin-budget.route.test.ts mocked the admin tool
// registry with a synthetic 17-tool stand-in, so it could never catch a
// mismatch between the *real* `createAdminChatTools()` output and the
// context-budget math in routes/api/chat.ts. This suite imports the real
// registry (with only its DB-backed leaves mocked, same as
// create-admin-chat-tools.test.ts) and asserts the actual numbers against
// `estimateToolDefinitionTokens` / the seeded admin model's context window —
// so a registry that grows again fails this test loudly instead of only
// surfacing as a runtime ADMIN_CONTEXT_TOO_LARGE on every admin chat request.
import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/agent-tools/admin-context.server", () => ({
  getAccessibleCourse: vi.fn(),
  listAccessibleCourses: vi.fn(),
  listAdminBugReportsForChat: vi.fn(),
  listAdminCourseEnrollments: vi.fn(),
  listAdminCourseTopics: vi.fn(),
  getAdminCourseTopic: vi.fn(),
  listAdminUsers: vi.fn(),
  resolveAdminCourseId: vi.fn(),
  resolveAdminUserId: vi.fn(),
}));

vi.mock("~/lib/chat-rag", () => ({
  runCourseMaterialSearchTool: vi.fn(),
}));

vi.mock("~/lib/agent-tools/admin-mutations.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/agent-tools/admin-mutations.server")>();
  return {
    ...actual,
    createAdminUser: vi.fn(),
    updateAdminUser: vi.fn(),
    deleteAdminUser: vi.fn(),
    createAdminEnrollment: vi.fn(),
    updateAdminEnrollmentRole: vi.fn(),
    deactivateAdminEnrollment: vi.fn(),
    updateAdminBugReportStatus: vi.fn(),
    createAdminCourseTopic: vi.fn(),
    updateAdminCourseTopic: vi.fn(),
    deleteAdminCourseTopic: vi.fn(),
    createAdminInvitationMutation: vi.fn(),
    revokeAdminInvitationMutation: vi.fn(),
    resendAdminInvitationMutation: vi.fn(),
    connectAdminCanvas: vi.fn(),
    syncAdminCanvasCourses: vi.fn(),
    disconnectAdminCanvas: vi.fn(),
    linkAdminCanvasRoster: vi.fn(),
    createAdminCourseMutation: vi.fn(),
    updateAdminCourseMutation: vi.fn(),
    deleteAdminCourseMutation: vi.fn(),
    publishAdminCourseMutation: vi.fn(),
    unpublishAdminCourseMutation: vi.fn(),
    updateAdminCourseRagSettingsMutation: vi.fn(),
    renameAdminCourseMaterialMutation: vi.fn(),
    deleteAdminCourseMaterialMutation: vi.fn(),
    updateAdminCourseEmbeddingSettingsMutation: vi.fn(),
    startAdminCourseReEmbedMutation: vi.fn(),
    syncAdminCanvasMaterialsMutation: vi.fn(),
    addAdminCourseTAMutation: vi.fn(),
    removeAdminCourseTAMutation: vi.fn(),
    updateAdminPolicyMutation: vi.fn(),
    createAdminAiProviderMutation: vi.fn(),
    updateAdminAiProviderMutation: vi.fn(),
    deleteAdminAiProviderMutation: vi.fn(),
    createAdminAiModelMutation: vi.fn(),
    updateAdminAiModelMutation: vi.fn(),
    deleteAdminAiModelMutation: vi.fn(),
    triggerAdminCronJobMutation: vi.fn(),
  };
});

vi.mock("~/lib/agent-tools/admin-platform.server", () => ({
  getAdminCourseRagSettings: vi.fn(),
  getAdminCourseEmbeddingSettings: vi.fn(),
  getAdminCourseReEmbedJob: vi.fn(),
  getAdminDashboardStats: vi.fn(),
  getAdminPolicies: vi.fn(),
  listAdminAiProviders: vi.fn(),
  listAdminCanvasMaterials: vi.fn(),
  listAdminCourseChats: vi.fn(),
  listAdminCourseMaterials: vi.fn(),
  listAdminCourseTAs: vi.fn(),
  listAdminCronJobs: vi.fn(),
  listAdminOllamaModels: vi.fn(),
  listAdminUnitChats: vi.fn(),
  listAdminVllmModels: vi.fn(),
}));

vi.mock("~/lib/agent-tools/admin-reads.server", () => ({
  getAdminCanvasIntegration: vi.fn(),
  listAdminCanvasCourses: vi.fn(),
  listAdminInvitations: vi.fn(),
}));

import {
  ADMIN_CORE_TOOL_NAMES,
  createAdminChatTools,
  pickCoreAdminChatTools,
} from "~/lib/agent-tools/create-admin-chat-tools";
import {
  estimateAdminToolStepReserve,
  estimateToolDefinitionTokens,
  promptFitsContextWindow,
} from "~/lib/ai/providers.server";

const ctx = {
  user: { id: "admin-1", role: "ADMIN" },
  effectiveCourseId: null,
  effectiveCourseCode: null,
};

// The seeded self-hosted tool-capable admin model (vllm qwen2.5-32b-instruct,
// DB maxTokens 8192) resolves to this window via resolveModelContextWindow.
const SEEDED_ADMIN_MODEL_CONTEXT_WINDOW = 16_384;

describe("admin chat tool registry vs. context budget (#1665 review)", () => {
  it("documents the full registry's real size and that it does not fit the seeded 16k model", () => {
    const tools = createAdminChatTools(ctx);
    const toolCount = Object.keys(tools).length;

    // A change here is expected as the registry grows — that's fine. What
    // matters is the assertion below: whatever this number is, the seeded
    // 16k admin model must not be sent the full registry (routes/api/chat.ts
    // trims to ADMIN_CORE_TOOL_NAMES instead — see the next test).
    expect(toolCount).toBeGreaterThan(0);

    const fullRegistryTokens = estimateToolDefinitionTokens(toolCount);
    const reserve = estimateAdminToolStepReserve(SEEDED_ADMIN_MODEL_CONTEXT_WINDOW);
    const fitsFullRegistry = promptFitsContextWindow({
      contextWindow: SEEDED_ADMIN_MODEL_CONTEXT_WINDOW,
      // Generous lower bound: tools + reserve alone, no system prompt/history.
      estimatedInputTokens: fullRegistryTokens + reserve,
      maxOutputTokens: 256,
      safetyBuffer: 256,
    });

    // This is the #1665 review finding: the full registry alone (before any
    // system prompt or history) already exceeds the seeded model's window.
    // If this ever flips to `true`, the full-registry path in
    // routes/api/chat.ts (`effectiveAdminTools`) can be revisited — until
    // then, admin chat on the seeded model MUST use the trimmed core set.
    expect(fitsFullRegistry).toBe(false);
  });

  it("the ADMIN_CORE_TOOL_NAMES subset routes/api/chat.ts sends on small windows fits comfortably", () => {
    const tools = createAdminChatTools(ctx);
    const coreTools = pickCoreAdminChatTools(tools);

    // Every core name must exist on the real registry (catches typos/renames
    // in ADMIN_CORE_TOOL_NAMES immediately instead of silently shrinking the
    // small-window tool set).
    expect(Object.keys(coreTools).sort()).toEqual([...ADMIN_CORE_TOOL_NAMES].sort());

    const coreTokens = estimateToolDefinitionTokens(Object.keys(coreTools).length);
    const reserve = estimateAdminToolStepReserve(SEEDED_ADMIN_MODEL_CONTEXT_WINDOW);
    // Realistic allowance for the default admin system prompt + a short user
    // question, in addition to the generous fixed reserve above.
    const systemAndMessageTokens = 900;

    const fits = promptFitsContextWindow({
      contextWindow: SEEDED_ADMIN_MODEL_CONTEXT_WINDOW,
      estimatedInputTokens: coreTokens + reserve + systemAndMessageTokens,
      maxOutputTokens: 512,
      safetyBuffer: 256,
    });

    expect(fits).toBe(true);
  });
});
