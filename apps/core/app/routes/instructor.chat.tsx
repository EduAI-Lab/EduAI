import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, redirect, useLoaderData } from "react-router";
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

/**
 * #1659: the only authority for "which courses can this instructor open a
 * chat for" — an active INSTRUCTOR enrollment on a published course. This is
 * intentionally the same fact `/api/chat`'s instructor-mode gate re-checks on
 * every turn (course-access.server.ts's shared RBAC contract), so a course
 * never appears in this dropdown that the API would then reject.
 */
async function listMyPublishedInstructorCourses(userId: string) {
  return prisma.course.findMany({
    where: {
      isPublished: true,
      deletedAt: null,
      enrollments: { some: { userId, isActive: true, role: "INSTRUCTOR" } },
    },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);

  if (!session?.user) {
    return redirect("/auth/login");
  }

  const courses = await listMyPublishedInstructorCourses(session.user.id);
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
    courses: courses.map((c): ChatCourseOption => ({ id: c.id, code: c.code, name: c.name })),
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
  if (body.code && NEEDS_PROVIDER_SETUP_CODES.has(body.code)) {
    return `${body.error} Open the settings (gear) icon next to the message box to add or fix a provider API key.`;
  }
  return body.error;
}

export default function InstructorChatPage() {
  const { chatModels, courses, user } = useLoaderData<typeof loader>();

  const [selectedModel, setSelectedModel] = useState(chatModels.length > 0 ? chatModels[0].id : "");
  const [selectedCourseCode, setSelectedCourseCodeState] = useState<string>(courses[0].code);
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
    courseCode: selectedCourseCode,
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
      courseCode: selectedCourseCode,
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
  // courseCode on a follow-up turn) — switching course mid-chat starts a new
  // one instead of resending the old chatId under a different course.
  const handleCourseChange = useCallback(
    (code: string | null) => {
      if (!code || code === selectedCourseCode) return;
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
      setSelectedCourseCodeState(code);
    },
    [chatId, selectedCourseCode, setInput, setMessages, stop],
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
          courseCode: selectedCourseCode,
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
        selectedCourseCode={selectedCourseCode}
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
