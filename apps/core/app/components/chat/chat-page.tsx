import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { AppSidebar } from "~/components/app-sidebar";
import { ChatCourseScopedView } from "~/components/chat/chat-course-scoped-view";
import { ChatGlobalView } from "~/components/chat/chat-global-view";
import { ChatHistoryPanel } from "~/components/chat/chat-history-panel";
import type {
  ChatCourseOption,
  ChatModelOption,
} from "~/components/chat/chat-view-types";
import type { ChatTranscript } from "~/hooks/api/use-chat-history";
import { useAssistiveUi } from "~/components/assistive/assistive-ui-provider";
import { CHAT_MESSAGE_INPUT_ID } from "~/components/assistive/active-highlight";
import { SiteHeader } from "~/components/site-header";
import {
  Button,
  SidebarInset,
  SidebarProvider,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@eduai/ui";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@eduai/ui";
import { IconHistory, IconPencilPlus } from "@tabler/icons-react";
import { useCourses } from "~/hooks/api/use-courses";
import { useAssistiveReorientation } from "~/hooks/use-assistive-reorientation";
import { useApiKeys } from "~/hooks/use-api-keys";
import { usesGlobalChat } from "~/lib/rbac";
import { postAssistiveClientEvent } from "~/lib/assistive-events.client";
import type { User } from "~/lib/auth/types";

const ACTIVE_CHAT_KEY = "eduai:activeChatId";

export interface ChatPageProps {
  chatModels: ChatModelOption[];
  user: User;
  assistDefault: boolean;
  lastCourseCode: string | null;
  /** Set when rendering an existing chat (from /chat/:chatId loader). */
  initialChatId?: string;
  /** Full transcript to seed useChat with on first render. */
  initialTranscript?: ChatTranscript;
}

export function ChatPage({
  chatModels,
  user,
  assistDefault,
  lastCourseCode,
  initialChatId,
  initialTranscript,
}: ChatPageProps) {
  const { assistive, setAssistive } = useAssistiveUi();
  const navigate = useNavigate();
  const isGlobalChat = usesGlobalChat(user);
  const { courses } = useCourses();
  const availableCourses: ChatCourseOption[] = isGlobalChat
    ? []
    : courses.map((c) => ({ id: c.id, name: c.name, code: c.code }));

  const [selectedModel, setSelectedModel] = useState(
    chatModels.length > 0 ? chatModels[0].id : "",
  );
  const [selectedCourseCode, setSelectedCourseCode] = useState<string | null>(
    initialTranscript?.chat.courseCode ?? lastCourseCode ?? null,
  );
  const [chatId, setChatId] = useState<string | null>(initialChatId ?? null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(
    initialTranscript?.chat.systemPrompt ?? null,
  );
  const [adhdAssist, setAdhdAssist] = useState(
    initialTranscript?.chat.adhdAssist ?? assistDefault ?? assistive,
  );
  const [focusMode, setFocusMode] = useState(false);
  const [reorientationEpoch, setReorientationEpoch] = useState(0);
  const [webToolsEnabled, setWebToolsEnabled] = useState(false);
  const wasLoadingRef = useRef(false);
  const mountTimeRef = useRef(Date.now());
  const { getValidApiKeys } = useApiKeys();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const restoreAttempted = useRef(false);
  const courseParamApplied = useRef(false);
  // Track whether we've already updated the URL after the first chatId assignment.
  const urlUpdatedRef = useRef(!!initialChatId);

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
    },
    [],
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

  // Apply ?courseCode= deep-link param once on mount, then strip it.
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

  // Fetch session metadata once we have a chatId (to pick up systemPrompt if
  // not already set — only needed for new chats where initialTranscript is absent).
  useEffect(() => {
    if (!chatId || systemPrompt || initialTranscript) return;
    void (async () => {
      try {
        const res = await fetch(`/api/chats/${chatId}`);
        if (!res.ok) return;
        const session = await res.json() as { systemPrompt?: string | null; adhdAssist?: boolean };
        if (session.systemPrompt) setSystemPrompt(session.systemPrompt);
        if (session.adhdAssist !== undefined) {
          setAdhdAssist(Boolean(session.adhdAssist));
          setAssistive(Boolean(session.adhdAssist), { silent: true });
        }
      } catch {
        // non-fatal
      }
    })();
  }, [chatId, systemPrompt, initialTranscript, setAssistive]);

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
      sendExtraMessageFields: true,
      initialMessages: (initialTranscript?.messages ?? []) as never,
      body: requestMetadata,
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

  // After the first response assigns a chatId (on /chat for a new conversation),
  // silently update the URL so a page refresh lands on /chat/:chatId.
  useEffect(() => {
    if (!chatId || urlUpdatedRef.current) return;
    urlUpdatedRef.current = true;
    window.sessionStorage.setItem(ACTIVE_CHAT_KEY, chatId);
    window.history.replaceState(null, "", `/chat/${chatId}`);
  }, [chatId]);

  // Persist active chat to sessionStorage whenever it changes.
  useEffect(() => {
    if (typeof window === "undefined" || !chatId) return;
    window.sessionStorage.setItem(ACTIVE_CHAT_KEY, chatId);
  }, [chatId]);

  // Auto-restore on mount: if we have no initialChatId (fresh /chat route),
  // check for a ?chatId= deep link or sessionStorage marker and navigate to
  // /chat/:chatId so the SSR route loads the conversation.
  useEffect(() => {
    if (restoreAttempted.current || typeof window === "undefined" || initialChatId) return;
    restoreAttempted.current = true;

    const deepLinkId = searchParams.get("chatId");
    const sessionId = window.sessionStorage.getItem(ACTIVE_CHAT_KEY);
    const target = deepLinkId || sessionId;
    if (!target) return;

    navigate(`/chat/${target}`, { replace: true });
  }, [initialChatId, navigate, searchParams]);

  const onSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      if (!chatId) {
        postAssistiveClientEvent({
          eventType: "task_initiation",
          adhdAssist,
          metrics: {
            durationMs: Date.now() - mountTimeRef.current,
            success: true,
            clientTimestamp: new Date().toISOString(),
          },
        });
      } else {
        postAssistiveClientEvent({
          eventType: "re_orientation",
          chatId,
          adhdAssist,
          metrics: {
            success: true,
            clientTimestamp: new Date().toISOString(),
          },
        });
      }
      handleSubmit(e);
    },
    [adhdAssist, chatId, handleSubmit],
  );

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

  const selectedModelInfo = chatModels.find((model) => model.id === selectedModel);

  const handleNewChat = useCallback(() => {
    setChatId(null);
    setMessages([]);
    setSystemPrompt(null);
    urlUpdatedRef.current = false;
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
      const data = await response.json() as { chatId?: string };
      if (data.chatId && !chatId) setChatId(data.chatId);
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
      onSubmit(formEvent);
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
    onSubmit,
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
                  <BreadcrumbLink asChild>
                    <Link to="/dashboard">Home</Link>
                  </BreadcrumbLink>
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
                onClick={() => {
                  handleNewChat();
                  navigate("/chat");
                }}
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
          onNewChat={() => {
            handleNewChat();
            setHistoryOpen(false);
            navigate("/chat");
          }}
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