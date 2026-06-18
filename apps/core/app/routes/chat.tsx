import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, redirect, useLoaderData, useFetcher } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { AppSidebar } from "~/components/app-sidebar";
import { ChatCourseScopedView } from "~/components/chat/chat-course-scoped-view";
import { ChatGlobalView } from "~/components/chat/chat-global-view";
import { ChatHeaderControls } from "~/components/chat/chat-header-controls";
import type {
  ChatCourseOption,
  ChatModelOption,
} from "~/components/chat/chat-view-types";
import { useAssistiveUi } from "~/components/assistive/assistive-ui-provider";
import { CHAT_MESSAGE_INPUT_ID } from "~/components/assistive/active-highlight";
import { SiteHeader } from "~/components/site-header";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb"
import { fetchChatSession } from "~/hooks/api/use-chat-sessions";
import { useCourses } from "~/hooks/api/use-courses";
import { useAssistiveReorientation } from "~/hooks/use-assistive-reorientation";
import { useApiKeys } from "~/hooks/use-api-keys";
import { auth } from "~/lib/auth/server";
import { usesGlobalChat } from "~/lib/rbac";
import prisma from "~/lib/prisma.server";
import { getUserPreference, saveUserPreference } from "~/lib/user-preferences.server";
import { getAccessibleCourseCodes } from "~/lib/courses/server";
import { parsePreferenceUpdates } from "~/lib/user-preferences";
import { logChatApiResponse, logChatUseChatError } from "~/lib/chat-client-log";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);

  if (!session?.user) {
    return redirect("/auth/login");
  }

  const dbModels = await prisma.aIModel.findMany({
    where: { isActive: true },
    include: {
      provider: true,
    },
    orderBy: [
      { provider: { name: "asc" } },
      { name: "asc" },
    ],
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

  const availableCourseCodes = await getAccessibleCourseCodes(session.user);
  const preferences = await getUserPreference(session.user.id, availableCourseCodes);

  return {
    chatModels,
    user: session.user,
    ...preferences,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const session = await auth.api.getSession(request);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const updates = parsePreferenceUpdates(await request.json().catch(() => null));
  if (Object.keys(updates).length === 0) {
    return new Response(JSON.stringify({ error: "No valid preference fields provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return saveUserPreference(session.user.id, updates);
}

export default function Chat() {
  const { chatModels, user, assistDefault, lastCourseCode } = useLoaderData<typeof loader>();
  const { assistive, setAssistive } = useAssistiveUi();
  const isGlobalChat = usesGlobalChat(user);
  const { courses } = useCourses();
  const availableCourses: ChatCourseOption[] = courses.map((c) => ({
    id: c.id,
    name: c.name,
    code: c.code,
  }));
  const [selectedModel, setSelectedModel] = useState(
    chatModels.length > 0 ? chatModels[0].id : "",
  );
  const [selectedCourseCode, setSelectedCourseCode] = useState<string | null>(
    lastCourseCode ?? null,
  );
  const [chatId, setChatId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [adhdAssist, setAdhdAssist] = useState(assistDefault ?? assistive);
  const [focusMode, setFocusMode] = useState(false);
  const [reorientationEpoch, setReorientationEpoch] = useState(0);
  const [webToolsEnabled, setWebToolsEnabled] = useState(false);
  const wasLoadingRef = useRef(false);
  const { getValidApiKeys } = useApiKeys();
  const prefsFetcher = useFetcher();

  const persistPreference = useCallback(
    (updates: { assistDefault?: boolean; lastCourseCode?: string | null }) => {
      prefsFetcher.submit(updates, { method: "post", encType: "application/json" });
    },
    [prefsFetcher],
  );

  const handleAssistiveChange = useCallback(
    (checked: boolean) => {
      setAdhdAssist(checked);
      if (!checked) setFocusMode(false);
      setAssistive(checked);
    },
    [setAssistive],
  );

  const handleCourseChange = useCallback(
    (code: string | null) => {
      setSelectedCourseCode(code);
      persistPreference({ lastCourseCode: code });
    },
    [persistPreference],
  );

  useEffect(() => {
    const el = document.documentElement;
    if (assistive && focusMode) {
      el.setAttribute("data-assistive-focus-mode", "true");
    } else {
      el.removeAttribute("data-assistive-focus-mode");
    }
    return () => el.removeAttribute("data-assistive-focus-mode");
  }, [assistive, focusMode]);

  useAssistiveReorientation({
    enabled: assistive && reorientationEpoch > 0,
    adhdAssist,
    chatId,
    epoch: reorientationEpoch,
  });

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

  const requestMetadata = {
    chatMode: "learning" as const,
    model: selectedModel,
    apiKeys: getValidApiKeys(),
    courseCode: isGlobalChat ? undefined : selectedCourseCode || undefined,
    chatId: chatId || undefined,
    systemPrompt: systemPrompt || undefined,
    adhdAssist,
  };

  const { messages, input, handleInputChange, handleSubmit, isLoading, stop } =
    useChat({
      api: "/api/chat",
      body: requestMetadata,
      experimental_prepareRequestBody: ({ messages, requestBody }) => ({
        ...(requestBody ?? requestMetadata),
        chatMode: "learning",
        messages: messages.slice(-1),
      }),
      onResponse: async (response) => {
        await logChatApiResponse(response, "learning-chat");
        const chatIdHeader = response.headers.get("X-Chat-Id");
        if (chatIdHeader && !chatId) {
          setChatId(chatIdHeader);
        }

        const webToolsHeader = response.headers.get("X-Web-Tools-Enabled");
        if (webToolsHeader !== null) {
          setWebToolsEnabled(webToolsHeader === "1");
        }
      },
      onError: (error) => logChatUseChatError(error, "learning-chat"),
    });

  useEffect(() => {
    const finishedLoading = wasLoadingRef.current && !isLoading;
    wasLoadingRef.current = isLoading;

    if (!assistive || !finishedLoading) return;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role !== "assistant") return;

    setReorientationEpoch((n) => n + 1);
    requestAnimationFrame(() => {
      document.getElementById(CHAT_MESSAGE_INPUT_ID)?.focus();
    });
  }, [assistive, isLoading, messages]);

  const selectedModelInfo = chatModels.find(
    (model) => model.id === selectedModel,
  );

  const handleSystemPromptSave = async (prompt: string | null) => {
    setSystemPrompt(prompt);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatMode: "learning",
          chatId: chatId || undefined,
          systemPrompt: prompt,
          messages: messages.length > 0 ? messages : [],
          model: selectedModel,
          apiKeys: getValidApiKeys(),
          courseCode: selectedCourseCode || undefined,
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
      handleSubmit(formEvent);
    });
  };

  const sharedViewProps = {
    chatModels,
    selectedModel,
    setSelectedModel,
    selectedModelInfo,
    selectedCourseCode,
    setSelectedCourseCode: handleCourseChange,
    availableCourses,
    messages,
    input,
    isLoading,
    adhdAssist,
    assistive,
    onAssistiveChange: handleAssistiveChange,
    focusMode,
    onFocusModeChange: setFocusMode,
    systemPrompt,
    onSystemPromptSave: handleSystemPromptSave,
    onInputChange: handleInputChange,
    onSubmit: handleSubmit,
    onStop: stop,
    onSelectPrompt: handlePromptSelect,
    webToolsEnabled,
  };

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" user={user} />
      <SidebarInset>
        <SiteHeader
          breadcrumbs={
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild><Link to="/dashboard">Home</Link></BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Chat</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
          actions={
            <ChatHeaderControls
              adhdAssist={adhdAssist}
              onAdhdAssistChange={handleAssistiveChange}
              focusMode={focusMode}
              onFocusModeChange={setFocusMode}
              systemPrompt={systemPrompt}
              onSystemPromptSave={handleSystemPromptSave}
            />
          }
        />
        {isGlobalChat ? (
          <ChatGlobalView {...sharedViewProps} />
        ) : (
          <ChatCourseScopedView {...sharedViewProps} />
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
