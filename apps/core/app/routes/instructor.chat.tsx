import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, redirect, useLoaderData, useSearchParams } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { InstructorChatView } from "~/components/chat/instructor-chat-view";
import { CoreAppShell } from "~/components/layout/core-app-shell";
import type { ChatCourseOption, ChatModelOption } from "~/components/chat/chat-view-types";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@eduai/ui";
import { fetchChatSession } from "~/hooks/api/use-chat-sessions";
import prisma from "~/lib/prisma.server";
import { useAssistiveUi } from "~/components/assistive/assistive-ui-provider";
import { logChatApiResponse, logChatUseChatError } from "~/lib/chat-client-log";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { getAuthorizedUnits, type RbacUser } from "~/lib/auth/course-access.server";

/**
 * #1659 review: the only authority for "which courses can this instructor
 * open a chat for" is an active INSTRUCTOR enrollment on a published course
 * — but that alone isn't enough to match `/api/chat`'s instructor-mode gate,
 * which reuses `resolveCourseAccessWithCourse` (course-access.server.ts).
 * That resolver decides access by PLATFORM role FIRST: every ADMIN gets
 * `admin`-level access and every in-unit UNIT_ADMIN gets `unit`-level access
 * — regardless of whether they *also* hold a real INSTRUCTOR enrollment on
 * the course, since enrollment is only consulted once neither short-circuit
 * applies. A raw enrollment lookup would therefore list a course here for a
 * dual-role caller (ADMIN, or in-unit UNIT_ADMIN, who happens to teach it)
 * that the API guard then always 403s on every turn — the exact drift this
 * function exists to prevent. Those callers have /admin/chat for
 * platform-wide ops instead, so we exclude them here rather than special-case
 * the guard, keeping this loader and the guard provably in lockstep.
 */
async function listMyPublishedInstructorCourses(user: RbacUser) {
  // Every ADMIN resolves to `admin`-level access on every course
  // (resolveAccess's first branch) — never `instructor`, no matter their
  // enrollment. Nothing they teach can ever pass the guard.
  if (user.role === "ADMIN") return [];

  const authorizedUnits = user.role === "UNIT_ADMIN" ? await getAuthorizedUnits(user) : null;

  const courses = await prisma.course.findMany({
    where: {
      isPublished: true,
      deletedAt: null,
      enrollments: { some: { userId: user.id, isActive: true, role: "INSTRUCTOR" } },
    },
    select: {
      id: true,
      code: true,
      name: true,
      startDate: true,
      section: true,
      department: true,
    },
    orderBy: { code: "asc" },
  });

  if (!authorizedUnits) return courses;

  // §19 unit lock (course-access.server.ts): a UNIT_ADMIN whose authorized
  // units include the course's department resolves to `unit`-level access
  // there — never `instructor` — regardless of their real enrollment. A
  // null department is never a unit match, so those courses fall through to
  // the (allowed) enrollment check same as the guard.
  return courses.filter((c) => c.department === null || !authorizedUnits.includes(c.department));
}

/**
 * #1659 review: Course.code is NOT globally unique — only
 * (code, startDate, section) is (schema.prisma's @@unique) — so two offerings
 * an instructor teaches can share a code (e.g. re-running COSC 121 next
 * term, or co-teaching two sections). The selector is keyed by `id` (see
 * `courseSelectionKey="id"` on InstructorChatView) so that ambiguity can
 * never mis-route a request, but the human-facing label still needs enough
 * context — term + section — to tell duplicate-code rows apart at a glance.
 * Courses whose code is unique within this instructor's own list keep the
 * plain code as their label.
 */
function labelInstructorCourses(
  courses: Array<{ id: string; code: string; name: string; startDate: Date; section: string }>,
): ChatCourseOption[] {
  const codeCounts = new Map<string, number>();
  for (const c of courses) {
    codeCounts.set(c.code, (codeCounts.get(c.code) ?? 0) + 1);
  }
  return courses.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    label:
      (codeCounts.get(c.code) ?? 0) > 1
        ? `${c.code} — ${c.startDate.getUTCFullYear()} Sec ${c.section}`
        : undefined,
  }));
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);

  if (!session?.user) {
    return redirect("/auth/login");
  }

  const courses = await listMyPublishedInstructorCourses(session.user);
  if (courses.length === 0) {
    // Not an instructor of any published course — nothing for this page to
    // show. Redirect rather than render an empty/broken chat shell.
    return redirect("/dashboard");
  }

  const dbModels = await prisma.aIModel.findMany({
    where: { isActive: true, supportsTools: true },
    include: { provider: true },
    orderBy: [{ provider: { name: "asc" } }, { name: "asc" }],
  });

  const chatModels: ChatModelOption[] = dbModels.map((model) => ({
    id: `${model.provider.name}:${model.modelId}`,
    name: model.name,
    description: model.description,
    provider: model.provider.name,
    maxTokens: model.maxTokens || undefined,
    supportsImages: model.supportsImages,
    supportsTools: model.supportsTools,
  }));

  return {
    chatModels,
    courses: labelInstructorCourses(courses),
    user: session.user,
  };
}

/**
 * Best-effort decode of a failed /api/chat call into a message an instructor
 * can act on — same approach as admin.chat.tsx's describeAdminChatError
 * (#1656): useChat throws `new Error(await response.text())` for any non-2xx
 * response, so the route's structured `{ error, code }` body round-trips as
 * error.message. Kept as its own copy rather than a shared import since the
 * two routes ship as independent PRs and the logic is a few lines either way.
 */
const chatRejectionBodySchema = z
  .object({
    error: z.string().trim().min(1).optional().catch(undefined),
    code: z.string().optional().catch(undefined),
    retryAfter: z.number().optional().catch(undefined),
  })
  .catch({});

const NEEDS_PROVIDER_SETUP_CODES = new Set(["INVALID_PROVIDER_CONFIG", "ADMIN_TOOLS_REQUIRED"]);

function describeInstructorChatError(error: Error): string {
  const fallback = error.message || "The course assistant could not respond.";

  let parsed: unknown;
  try {
    parsed = JSON.parse(error.message);
  } catch {
    return fallback;
  }

  const body = chatRejectionBodySchema.parse(parsed);
  if (!body.error) return fallback;
  if (body.error === "RATE_LIMITED") {
    // Rate limiting on /api/chat is keyed on the acting user, not on
    // chatMode, so an instructor hitting /instructor/chat too fast gets the
    // same { error: "RATE_LIMITED", retryAfter } rejection an admin would
    // (see admin.chat.tsx's describeAdminChatError, #1656). The schema
    // already parses retryAfter as number | undefined (or drops it via
    // .catch on a malformed value) — no further narrowing needed.
    return body.retryAfter !== undefined
      ? `You're sending messages too quickly. Try again in ${body.retryAfter}s.`
      : "You're sending messages too quickly. Wait a moment and try again.";
  }
  if (body.code && NEEDS_PROVIDER_SETUP_CODES.has(body.code)) {
    return `${body.error} Open the settings (gear) icon next to the message box to add or fix a provider API key.`;
  }
  return body.error;
}

export default function InstructorChatPage() {
  const { chatModels, courses, user } = useLoaderData<typeof loader>();

  const [selectedModel, setSelectedModel] = useState(chatModels.length > 0 ? chatModels[0].id : "");
  const [searchParams] = useSearchParams();
  // #1659 review: keyed by course ID, not code — Course.code is not globally
  // unique (only (code, startDate, section) is), so a code-keyed selector
  // could collide across two offerings this instructor teaches. The API is
  // sent `courseId` to match (see requestMetadata below). A `?courseId=`
  // param (dashboard course-card "Chat" button) preselects that course when
  // it's one this instructor actually teaches; otherwise falls back to the
  // first course, same as before #1659's dashboard wiring.
  const [selectedCourseId, setSelectedCourseIdState] = useState<string>(() => {
    const requested = searchParams.get("courseId");
    return requested && courses.some((c) => c.id === requested) ? requested : courses[0].id;
  });
  const [chatId, setChatId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [adhdAssist, setAdhdAssist] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [webToolsEnabled] = useState(false);
  const [routedModelByMessageId, setRoutedModelByMessageId] = useState<Record<string, string>>({});
  const [streamingRoutedRegistryId, setStreamingRoutedRegistryId] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const pendingRoutedRegistryIdRef = useRef<string | null>(null);
  const { assistive, setAssistive } = useAssistiveUi();

  useEffect(() => {
    if (!chatId || systemPrompt) {
      return;
    }

    void (async () => {
      const session = await fetchChatSession(chatId);
      if (!session) {
        return;
      }
      if (session.systemPrompt) {
        setSystemPrompt(session.systemPrompt);
      }
      setAdhdAssist(Boolean(session.adhdAssist));
      setAssistive(Boolean(session.adhdAssist));
    })();
  }, [chatId, systemPrompt, setAssistive]);

  useEffect(() => {
    const el = document.documentElement;
    if (focusMode) {
      el.setAttribute("data-assistive-focus-mode", "true");
    } else {
      el.removeAttribute("data-assistive-focus-mode");
    }
    return () => el.removeAttribute("data-assistive-focus-mode");
  }, [focusMode]);

  const handleAssistiveChange = useCallback(
    (checked: boolean) => {
      setAdhdAssist(checked);
      setAssistive(checked);
    },
    [setAssistive],
  );

  const requestMetadata = {
    chatMode: "instructor" as const,
    model: selectedModel,
    courseId: selectedCourseId,
    chatId: chatId || undefined,
    systemPrompt: systemPrompt || undefined,
    adhdAssist,
  };

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    stop,
    setMessages,
    setInput,
  } = useChat({
    api: "/api/chat",
    sendExtraMessageFields: true,
    body: requestMetadata,
    experimental_prepareRequestBody: ({ messages: chatMessages, requestBody }) => ({
      ...(requestBody ?? requestMetadata),
      chatMode: "instructor",
      courseId: selectedCourseId,
      messages: chatMessages.slice(-1),
    }),
    onResponse: async (response) => {
      const routedHeader = response.headers.get("X-Routed-Model")?.trim();
      const routed = routedHeader && routedHeader.length > 0 ? routedHeader : null;
      pendingRoutedRegistryIdRef.current = routed;
      setStreamingRoutedRegistryId(routed);
      setChatError(null);

      await logChatApiResponse(response, "instructor-chat");
      const chatIdHeader = response.headers.get("X-Chat-Id");
      if (chatIdHeader && !chatId) {
        setChatId(chatIdHeader);
      }
    },
    onFinish: (message) => {
      const routed = pendingRoutedRegistryIdRef.current;
      if (message.role === "assistant" && routed) {
        setRoutedModelByMessageId((prev) => ({ ...prev, [message.id]: routed }));
      }
      pendingRoutedRegistryIdRef.current = null;
      setStreamingRoutedRegistryId(null);
    },
    onError: (error) => {
      logChatUseChatError(error, "instructor-chat");
      setChatError(describeInstructorChatError(error));
      pendingRoutedRegistryIdRef.current = null;
      setStreamingRoutedRegistryId(null);
    },
  });

  const handleStop = useCallback(() => {
    pendingRoutedRegistryIdRef.current = null;
    setStreamingRoutedRegistryId(null);
    stop();
  }, [stop]);

  const handleChatSubmit = useCallback<typeof handleSubmit>(
    (event) => {
      setChatError(null);
      handleSubmit(event);
    },
    [handleSubmit],
  );

  // A persisted chat is pinned to one course (chat.ts rejects a mismatched
  // courseId on a follow-up turn) — switching course mid-chat starts a new
  // one instead of resending the old chatId under a different course.
  const handleCourseChange = useCallback(
    (id: string | null) => {
      if (!id || id === selectedCourseId) return;
      if (chatId) {
        stop();
        setChatId(null);
        setSystemPrompt(null);
        setMessages([]);
        setInput("");
        setRoutedModelByMessageId({});
        setStreamingRoutedRegistryId(null);
        setChatError(null);
      }
      setSelectedCourseIdState(id);
    },
    [chatId, selectedCourseId, setInput, setMessages, stop],
  );

  const selectedModelInfo = chatModels.find((model) => model.id === selectedModel);

  const handleSystemPromptSave = async (prompt: string | null) => {
    setSystemPrompt(prompt);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatMode: "instructor",
          courseId: selectedCourseId,
          chatId: chatId || undefined,
          systemPrompt: prompt,
          messages: messages.length > 0 ? messages : [],
          model: selectedModel,
          adhdAssist,
          streaming: false,
        }),
      });
      const data = await response.json();
      if (data.chatId && !chatId) {
        setChatId(data.chatId);
      }
    } catch (error) {
      console.error("Failed to save system prompt:", error);
    }
  };

  const handlePromptSelect = (prompt: string) => {
    const inputEvent = {
      target: { value: prompt },
      currentTarget: { value: prompt },
    } as React.ChangeEvent<HTMLInputElement>;

    handleInputChange(inputEvent);

    requestAnimationFrame(() => {
      const formEvent = {
        preventDefault: () => {},
        currentTarget: {} as HTMLFormElement,
      } as React.FormEvent<HTMLFormElement>;
      handleChatSubmit(formEvent);
    });
  };

  return (
    <CoreAppShell
      user={user}
      insetClassName="flex flex-col min-h-0"
      breadcrumbs={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/dashboard">Home</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Course Assistant</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      {chatError && (
        <Alert variant="destructive" className="mx-4 mt-4 shrink-0 md:mx-6">
          <AlertTitle>Course assistant couldn&apos;t respond</AlertTitle>
          <AlertDescription>{chatError}</AlertDescription>
        </Alert>
      )}
      <InstructorChatView
        chatModels={chatModels}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        selectedModelInfo={selectedModelInfo}
        selectedCourseCode={selectedCourseId}
        setSelectedCourseCode={handleCourseChange}
        availableCourses={courses}
        messages={messages}
        input={input}
        isLoading={isLoading}
        adhdAssist={adhdAssist}
        assistive={assistive}
        onAssistiveChange={handleAssistiveChange}
        focusMode={focusMode}
        onFocusModeChange={setFocusMode}
        webToolsEnabled={webToolsEnabled}
        systemPrompt={systemPrompt}
        onSystemPromptSave={handleSystemPromptSave}
        onInputChange={handleInputChange}
        onSubmit={handleChatSubmit}
        onStop={handleStop}
        onSelectPrompt={handlePromptSelect}
        routedModelByMessageId={routedModelByMessageId}
        streamingRoutedRegistryId={streamingRoutedRegistryId}
      />
    </CoreAppShell>
  );
}
