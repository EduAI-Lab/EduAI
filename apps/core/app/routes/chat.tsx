import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, redirect, useLoaderData, useFetcher, useSearchParams } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { IconHistory, IconPencilPlus } from "@tabler/icons-react";

import { AppSidebar } from "~/components/app-sidebar";
import { ChatCourseScopedView } from "~/components/chat/chat-course-scoped-view";
import { ChatGlobalView } from "~/components/chat/chat-global-view";
import { ChatHistoryPanel } from "~/components/chat/chat-history-panel";
import { ChatTranscriptViewer } from "~/components/chat/chat-transcript-viewer";
import type {
  ChatCourseOption,
  ChatModelOption,
} from "~/components/chat/chat-view-types";
import { fetchChatTranscript, type ChatTranscript } from "~/hooks/api/use-chat-history";
import { useAssistiveUi } from "~/components/assistive/assistive-ui-provider";
import { CHAT_MESSAGE_INPUT_ID } from "~/components/assistive/active-highlight";
import { SiteHeader } from "~/components/site-header";
import { Button, SidebarInset, SidebarProvider, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@eduai/ui";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@eduai/ui"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@eduai/ui"
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

/**
 * Per-tab marker for the chat the user is actively in. Lives in sessionStorage
 * so it survives navigating away and back within the same tab (temporary leave)
 * but clears when the tab closes (fresh start) — the "smart restore" heuristic.
 */
const ACTIVE_CHAT_KEY = "eduai:activeChatId";

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
  const availableCourses: ChatCourseOption[] = isGlobalChat
    ? []
    : courses.map((c) => ({ id: c.id, name: c.name, code: c.code }));
  const [selectedModel, setSelectedModel] = useState(
    chatModels.length > 0 ? chatModels[0].id : "",
  );
  const [selectedCourseCode, setSelectedCourseCode] = useState<string | null>(
    lastCourseCode ?? null,
  );
  const [chatId, setChatId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [adhdAssist, setAdhdAssist] = useState(assistDefault ?? assistive);
  const [readOnlyTranscript, setReadOnlyTranscript] = useState<ChatTranscript | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [reorientationEpoch, setReorientationEpoch] = useState(0);
  const [webToolsEnabled, setWebToolsEnabled] = useState(false);
  const wasLoadingRef = useRef(false);
  const { getValidApiKeys } = useApiKeys();
  const prefsFetcher = useFetcher();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  // Guards the one-shot auto-restore so it never re-fires on later renders.
  const restoreAttempted = useRef(false);
  // One-shot flag so ?courseCode= param is only applied on mount.
  const courseParamApplied = useRef(false);

  const persistPreference = useCallback(
    (updates: { assistDefault?: boolean; lastCourseCode?: string | null }) => {
      prefsFetcher.submit(updates, { method: "post", encType: "application/json" });
    },
    [prefsFetcher],
  );

  const handleAssistiveChange = useCallback(
    (checked: boolean) => {
      setAdhdAssist(checked);
      if (!checked) {
        setFocusMode(false);
      }
      // setAssistive already persists via PATCH /api/preferences — no extra submit needed.
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
    if (isGlobalChat) setSelectedCourseCode(null);
  }, [isGlobalChat]);

  // Apply ?courseCode= deep-link param once on mount, then strip it from URL.
  useEffect(() => {
    if (courseParamApplied.current || isGlobalChat) return;
    const code = searchParams.get("courseCode");
    if (!code) return;
    courseParamApplied.current = true;
    setSelectedCourseCode(code);
    const next = new URLSearchParams(searchParams);
    next.delete("courseCode");
    setSearchParams(next, { replace: true });
  }, [isGlobalChat, searchParams, setSearchParams]);

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
    model: selectedModel,
    apiKeys: getValidApiKeys(),
    courseCode: isGlobalChat ? undefined : selectedCourseCode || undefined,
    chatId: chatId || undefined,
    systemPrompt: systemPrompt || undefined,
    adhdAssist,
  };

  const { messages, input, handleInputChange, handleSubmit, isLoading, stop, setMessages } =
    useChat({
      api: "/api/chat",
      // Persist stable client message ids to the server. Without this, AI SDK v4
      // strips `id` from the request body, so the server stamps a fresh UUID for
      // every user message on every turn — defeating the (chatId, messageId)
      // dedup and re-saving the entire user history each turn (chat-history dup bug).
      sendExtraMessageFields: true,
      body: requestMetadata,
      // #487: send only the latest turn to the server, not the full history.
      // Spreads requestBody (carrying the stable message id from
      // sendExtraMessageFields) so dedup + latest-turn-only both hold.
      experimental_prepareRequestBody: ({ messages, requestBody }) => ({
        ...(requestBody ?? requestMetadata),
        messages: messages.slice(-1),
      }),
      onResponse: async (response) => {
        const chatIdHeader = response.headers.get("X-Chat-Id");
        if (chatIdHeader && !chatId) {
          setChatId(chatIdHeader);
        }
        const webToolsHeader = response.headers.get("X-Web-Tools-Enabled");
        if (webToolsHeader !== null) {
          setWebToolsEnabled(webToolsHeader === "1");
        }
      },
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

  // Persist the active chat per-tab so it can be restored on a temporary leave.
  useEffect(() => {
    if (typeof window === "undefined" || !chatId) return;
    window.sessionStorage.setItem(ACTIVE_CHAT_KEY, chatId);
  }, [chatId]);

  const restoreChat = useCallback(
    async (id: string): Promise<boolean> => {
      const transcript = await fetchChatTranscript(id);
      // Non-owner chats open read-only; never hydrate them into the live composer.
      if (!transcript) {
        window.sessionStorage.removeItem(ACTIVE_CHAT_KEY);
        return false;
      }
      if (!transcript.canEdit) {
        window.sessionStorage.removeItem(ACTIVE_CHAT_KEY);
        setReadOnlyTranscript(transcript);
        return false;
      }
      setChatId(id);
      setMessages(transcript.messages as never);
      setSystemPrompt(transcript.chat.systemPrompt ?? null);
      setAdhdAssist(Boolean(transcript.chat.adhdAssist));
      setAssistive(Boolean(transcript.chat.adhdAssist));
      if (!isGlobalChat && transcript.chat.courseCode) {
        setSelectedCourseCode(transcript.chat.courseCode);
      }
      window.sessionStorage.setItem(ACTIVE_CHAT_KEY, id);
      return true;
    },
    [setMessages, setAssistive, isGlobalChat],
  );

  // Smart auto-restore on mount: an explicit ?chatId deep link wins; otherwise
  // the per-tab marker means the user only briefly left — resume that chat. A
  // fresh tab has no marker, so it starts clean.
  useEffect(() => {
    if (restoreAttempted.current || typeof window === "undefined") return;
    restoreAttempted.current = true;

    const deepLinkId = searchParams.get("chatId");
    const sessionId = window.sessionStorage.getItem(ACTIVE_CHAT_KEY);
    const target = deepLinkId || sessionId;
    if (!target) return;

    void (async () => {
      const ok = await restoreChat(target);
      if (ok && deepLinkId) {
        searchParams.delete("chatId");
        setSearchParams(searchParams, { replace: true });
      }
    })();
  }, [restoreChat, searchParams, setSearchParams]);

  const handleSelectChat = useCallback(
    async (id: string) => {
      await restoreChat(id);
      setHistoryOpen(false);
    },
    [restoreChat],
  );

  const handleNewChat = useCallback(() => {
    setChatId(null);
    setMessages([]);
    setSystemPrompt(null);
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(ACTIVE_CHAT_KEY);
    }
  }, [setMessages]);

  const handleSystemPromptSave = async (prompt: string | null) => {
    setSystemPrompt(prompt);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: chatId || undefined,
          systemPrompt: prompt,
          messages: messages.length > 0 ? messages : [],
          model: selectedModel,
          apiKeys: getValidApiKeys(),
          courseCode: isGlobalChat ? undefined : selectedCourseCode || undefined,
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
    webToolsEnabled,
    onInputChange: handleInputChange,
    onSubmit: handleSubmit,
    onStop: stop,
    onSelectPrompt: handlePromptSelect,
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
      <AppSidebar user={user} />
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
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleNewChat}
                aria-label="Start a new chat"
              >
                <IconPencilPlus className="h-4 w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">New chat</span>
              </Button>
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setHistoryOpen((prev) => !prev)}
                      aria-label="Open chat history"
                      className="h-8 w-8"
                    >
                      <IconHistory className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Chat history</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          }
        />
        <ChatHistoryPanel
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          activeChatId={chatId}
          onSelect={handleSelectChat}
          onNewChat={handleNewChat}
        />
        {/* Read-only view for non-owned chats (deep links, dashboard recent chats) */}
        <Sheet open={readOnlyTranscript !== null} onOpenChange={(open) => { if (!open) setReadOnlyTranscript(null); }}>
          <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0">
            <SheetHeader className="px-5 pt-5 pb-3 border-b border-border flex-shrink-0">
              <SheetTitle className="text-[15px]">
                {readOnlyTranscript?.chat.title ?? "Conversation"}
              </SheetTitle>
              <SheetDescription className="text-[13px]">
                {readOnlyTranscript?.chat.ownerName
                  ? `${readOnlyTranscript.chat.ownerName}'s conversation`
                  : "Read-only conversation"}
                {readOnlyTranscript?.chat.courseCode
                  ? ` · ${readOnlyTranscript.chat.courseCode}`
                  : null}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <ChatTranscriptViewer
                messages={readOnlyTranscript?.messages ?? []}
                ownerName={readOnlyTranscript?.chat.ownerName}
                courseCode={readOnlyTranscript?.chat.courseCode}
              />
            </div>
          </SheetContent>
        </Sheet>
        {isGlobalChat ? (
          <ChatGlobalView {...sharedViewProps} />
        ) : (
          <ChatCourseScopedView {...sharedViewProps} />
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
