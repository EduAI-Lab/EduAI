import { useChat } from "@ai-sdk/react";
import type { Message } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher, useLocation, useNavigate, useSearchParams } from "react-router";
import { IconHistory } from "@tabler/icons-react";

import { CoreAppShell } from "~/components/layout/core-app-shell";
import { ChatCourseScopedView } from "~/components/chat/chat-course-scoped-view";
import { ChatHistoryPanel } from "~/components/chat/chat-history-panel";
import { ChatHistoryRail } from "~/components/chat/chat-history-rail";
import { ChatPrivacyNoticeDialog } from "~/components/chat/chat-privacy-notice-dialog";
import { ChatTranscriptViewer } from "~/components/chat/chat-transcript-viewer";
import type {
  ChatCourseOption,
  ChatModelOption,
} from "~/components/chat/chat-view-types";
import type { ChatTranscript } from "~/hooks/api/use-chat-history";
import { useChatHistory } from "~/hooks/api/use-chat-history";
import { useAssistiveUi } from "~/components/assistive/assistive-ui-provider";
import { CHAT_MESSAGE_INPUT_ID } from "~/components/assistive/active-highlight";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@eduai/ui";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@eduai/ui";
import { useCourses } from "~/hooks/api/use-courses";
import { useAssistiveReorientation } from "~/hooks/use-assistive-reorientation";
import { postAssistiveClientEvent } from "~/lib/assistive-events.client";
import {
  acknowledgeChatPrivacyNotice,
  hasAcknowledgedChatPrivacyNotice,
} from "~/lib/chat/chat-privacy-notice";
import { logChatApiResponse, logChatUseChatError } from "~/lib/chat-client-log";
import { resolveCourseChangeAction } from "./chat-course-change";
import { defaultChatModelId } from "~/lib/chat-auto-model";
import type { ChatBaseData } from "~/lib/chat/chat-route.server";
import {
  resolvedModelIdFromMessage,
  wasAutoRoutedFromMessage,
} from "~/lib/chat/chat-message-metadata";

export interface ChatScreenProps {
  /** Base loader data resolved by both `/chat` and `/chat/:chatId`. */
  data: ChatBaseData;
  /**
   * Transcript hydrated from the DB by the `/chat/:chatId` route loader, or null
   * on `/chat` (blank conversation). Non-editable transcripts open read-only.
   * The route is the single source of truth — there is no sessionStorage restore.
   */
  initialTranscript: ChatTranscript | null;
}

type ChatNavigationState = {
  focusMode?: boolean;
  selectedModel?: string;
};

export function ChatScreen({ data, initialTranscript }: ChatScreenProps) {
  const { chatModels, routerAutoEnabled, user, assistDefault, lastCourseCode } = data;
  // Only an editable (owned) transcript seeds the live composer; everything else
  // opens in the read-only viewer.
  const editableTranscript =
    initialTranscript && initialTranscript.canEdit ? initialTranscript : null;

  const navigate = useNavigate();
  const location = useLocation();
  const navigationState = location.state as ChatNavigationState | null;
  const [searchParams, setSearchParams] = useSearchParams();
  const { assistive, setAssistive } = useAssistiveUi();
  // Course picker, not a table — one bounded page instead of the whole list (#1041).
  const { courses } = useCourses({ pageSize: 200 });
  // Every chat is course-scoped now (global/no-course chat was removed). The
  // course list is already RBAC-filtered: ADMIN sees all courses, UNIT_ADMIN
  // sees courses in their authorized units, others see their enrollments.
  const availableCourses: ChatCourseOption[] = courses.map((c) => ({
    id: c.id,
    name: c.name,
    code: c.code,
  }));

  const isStudentWithCourseChat = user.role === "STUDENT";
  const hasNoCourses = availableCourses.length === 0;
  const disabledReason = hasNoCourses ? "no-courses" : undefined;
  const [selectedModel, setSelectedModel] = useState(() => {
    const navigatedModel = navigationState?.selectedModel;
    return navigatedModel &&
      chatModels.some((model) => model.id === navigatedModel)
      ? navigatedModel
      : defaultChatModelId(chatModels, routerAutoEnabled);
  });
  const [selectedCourseCode, setSelectedCourseCode] = useState<string | null>(
    editableTranscript?.chat.courseCode ??
      searchParams.get("courseCode") ??
      lastCourseCode ??
      null,
  );
  const [chatId, setChatId] = useState<string | null>(
    editableTranscript?.chat.id ?? null,
  );
  const [systemPrompt, setSystemPrompt] = useState<string | null>(
    editableTranscript?.chat.systemPrompt ?? null,
  );
  const [adhdAssist, setAdhdAssist] = useState(
    editableTranscript ? Boolean(editableTranscript.chat.adhdAssist) : (assistDefault ?? assistive),
  );
  const [readOnlyTranscript, setReadOnlyTranscript] = useState<ChatTranscript | null>(
    initialTranscript && !initialTranscript.canEdit ? initialTranscript : null,
  );
  // Focus mode and the explicit model choice are carried across the
  // /chat -> /chat/:chatId replace-navigation below. That route swap remounts
  // ChatScreen (see chat.$chatId.tsx's key), so uncarried state would reset to
  // its defaults — notably switching a concrete model back to Auto. focusMode
  // is read via focusModeRef at those call sites (see below) to avoid a
  // stale-closure revert (#1244); selectedModel is read directly since the
  // model selector is disabled while a request is in flight.
  const [focusMode, setFocusMode] = useState(
    Boolean(navigationState?.focusMode),
  );
  // onFinish/handleSystemPromptSave fire after the user may have toggled Focus
  // Mode mid-response; a ref keeps the replace-navigation below reading the
  // live value instead of whatever was true when that callback was bound (#1244).
  const focusModeRef = useRef(focusMode);
  useEffect(() => {
    focusModeRef.current = focusMode;
  }, [focusMode]);
  const [reorientationEpoch, setReorientationEpoch] = useState(0);
  const [webToolsEnabled, setWebToolsEnabled] = useState(false);
  /** Persisted/header registry ids keyed by their assistant message id. */
  const [routedModelByMessageId, setRoutedModelByMessageId] = useState<
    Record<string, string>
  >(() => {
    const hydrated: Record<string, string> = {};
    for (const message of editableTranscript?.messages ?? []) {
      const id =
        typeof message.id === "string" && message.id.trim().length > 0
          ? message.id
          : null;
      const resolvedModelId = resolvedModelIdFromMessage(message);
      if (id && resolvedModelId) hydrated[id] = resolvedModelId;
    }
    return hydrated;
  });
  /** Latest streamed response registry id (shown on the in-flight assistant bubble). */
  const [streamingRoutedRegistryId, setStreamingRoutedRegistryId] = useState<
    string | null
  >(null);
  /**
   * Whether each assistant message's request was sent with an auto mode
   * selected, keyed by message id — captured at send time so switching the
   * selector afterward doesn't retroactively change older messages' labels.
   */
  const [wasAutoRoutedByMessageId, setWasAutoRoutedByMessageId] = useState<
    Record<string, boolean>
  >(() => {
    const hydrated: Record<string, boolean> = {};
    for (const message of editableTranscript?.messages ?? []) {
      const id =
        typeof message.id === "string" && message.id.trim().length > 0
          ? message.id
          : null;
      if (id && resolvedModelIdFromMessage(message)) {
        hydrated[id] = wasAutoRoutedFromMessage(message);
      }
    }
    return hydrated;
  });
  const [streamingWasAutoRouted, setStreamingWasAutoRouted] = useState(false);
  const pendingRoutedRegistryIdRef = useRef<string | null>(null);
  const pendingWasAutoRoutedRef = useRef(false);
  const wasLoadingRef = useRef(false);
  const mountTimeRef = useRef(Date.now());
  const pendingNavigateChatId = useRef<string | null>(null);
  const prefsFetcher = useFetcher();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [privacyNoticeOpen, setPrivacyNoticeOpen] = useState(false);
  const { chats, isLoading: historyLoading, error: historyError, refresh: refreshHistory } =
    useChatHistory({ scope: "own", limit: 50 });
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
      // setAssistive already persists via PATCH /api/preferences — no extra submit needed.
      setAssistive(checked);
    },
    [setAssistive],
  );

  // Students see a first-visit privacy notice explaining course-chat visibility.
  useEffect(() => {
    if (!isStudentWithCourseChat) return;
    if (!hasAcknowledgedChatPrivacyNotice(user.id)) {
      setPrivacyNoticeOpen(true);
    }
  }, [isStudentWithCourseChat, user.id]);

  const handlePrivacyNoticeAcknowledge = useCallback(() => {
    acknowledgeChatPrivacyNotice(user.id);
    setPrivacyNoticeOpen(false);
  }, [user.id]);

  // Mirror the loaded chat's assist setting into the global assistive UI without
  // re-persisting it (silent). Runs once per mounted chat — the /chat/:chatId
  // route is keyed by chatId, so switching chats remounts and re-seeds.
  useEffect(() => {
    if (editableTranscript) {
      setAssistive(Boolean(editableTranscript.chat.adhdAssist), { silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    if (focusMode) {
      el.setAttribute("data-assistive-focus-mode", "true");
    } else {
      el.removeAttribute("data-assistive-focus-mode");
    }
    return () => el.removeAttribute("data-assistive-focus-mode");
  }, [focusMode]);

  // Lock document scroll while chat owns an internal message scroller — otherwise
  // the page can grow past the composer and show empty space underneath.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
    };
  }, []);

  useAssistiveReorientation({
    enabled: assistive && reorientationEpoch > 0,
    adhdAssist,
    chatId,
    epoch: reorientationEpoch,
  });

  // The state initializer applies ?courseCode= before the default-course effect
  // can run. Strip the one-shot handoff parameter after mount.
  useEffect(() => {
    if (courseParamApplied.current) return;
    const code = searchParams.get("courseCode");
    if (!code) return;
    courseParamApplied.current = true;
    const next = new URLSearchParams(searchParams);
    next.delete("courseCode");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Default to a course so chat always has context (no "no course" option). Picks
  // the first available course unless a valid one is already selected.
  useEffect(() => {
    if (availableCourses.length === 0) return;
    const isValid =
      selectedCourseCode !== null &&
      availableCourses.some((c) => c.code === selectedCourseCode);
    if (!isValid) setSelectedCourseCode(availableCourses[0].code);
  }, [selectedCourseCode, availableCourses]);

  const requestMetadata = {
    chatMode: "learning" as const,
    model: selectedModel,
    courseCode: selectedCourseCode || undefined,
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
      // Seed the composer from the route loader's transcript (DB is the source of
      // truth). Blank on /chat; full history on /chat/:chatId for owned chats.
      initialMessages: (editableTranscript?.messages as Message[] | undefined) ?? undefined,
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
        chatMode: "learning",
        messages: messages.slice(-1),
      }),
      onResponse: async (response) => {
        const routedHeader = response.headers.get("X-Routed-Model")?.trim();
        const routed =
          routedHeader && routedHeader.length > 0 ? routedHeader : null;
        pendingRoutedRegistryIdRef.current = routed;
        setStreamingRoutedRegistryId(routed);
        // The selector is disabled while a request is in flight, so this
        // still reflects what was selected when the request was sent.
        const wasAutoRouted = selectedModel === "auto" || selectedModel === "auto-llm";
        pendingWasAutoRoutedRef.current = wasAutoRouted;
        setStreamingWasAutoRouted(wasAutoRouted);

        await logChatApiResponse(response, "learning-chat");
        const chatIdHeader = response.headers.get("X-Chat-Id");
        if (chatIdHeader && !chatId) {
          setChatId(chatIdHeader);
          pendingNavigateChatId.current = chatIdHeader;
          void refreshHistory();
        }
        const webToolsHeader = response.headers.get("X-Web-Tools-Enabled");
        if (webToolsHeader !== null) {
          setWebToolsEnabled(webToolsHeader === "1");
        }
      },
      onFinish: (message) => {
        const routed = pendingRoutedRegistryIdRef.current;
        if (message.role === "assistant" && routed) {
          setRoutedModelByMessageId((prev) => ({ ...prev, [message.id]: routed }));
          setWasAutoRoutedByMessageId((prev) => ({
            ...prev,
            [message.id]: pendingWasAutoRoutedRef.current,
          }));
        }
        pendingRoutedRegistryIdRef.current = null;
        pendingWasAutoRoutedRef.current = false;
        setStreamingRoutedRegistryId(null);
        setStreamingWasAutoRouted(false);

        const id = pendingNavigateChatId.current;
        if (id && location.pathname === "/chat") {
          pendingNavigateChatId.current = null;
          navigate(`/chat/${id}`, {
            replace: true,
            state: { focusMode: focusModeRef.current, selectedModel },
          });
        }
      },
      onError: (error) => {
        logChatUseChatError(error, "learning-chat");
        pendingRoutedRegistryIdRef.current = null;
        pendingWasAutoRoutedRef.current = false;
        setStreamingRoutedRegistryId(null);
        setStreamingWasAutoRouted(false);
      },
    });

  const handleCourseChange = useCallback(
    (code: string | null) => {
      const action = resolveCourseChangeAction({
        currentCourseCode: selectedCourseCode,
        nextCourseCode: code,
        chatId,
      });
      if (action.kind === "noop") return;

      persistPreference({ lastCourseCode: code });

      if (action.kind === "new-chat") {
        // A chat id can arrive in onResponse while the URL is still /chat. A
        // same-route navigation does not remount this component, so clear all
        // persisted/in-flight state before handing off the selected course.
        stop();
        pendingNavigateChatId.current = null;
        pendingRoutedRegistryIdRef.current = null;
        setChatId(null);
        setSystemPrompt(null);
        setMessages([]);
        setInput("");
        setSelectedCourseCode(action.courseCode);
        setRoutedModelByMessageId({});
        setStreamingRoutedRegistryId(null);
        setWebToolsEnabled(false);
        navigate(action.to, { state: { focusMode } });
        return;
      }

      setSelectedCourseCode(action.courseCode);
    },
    [
      chatId,
      focusMode,
      navigate,
      persistPreference,
      selectedCourseCode,
      setInput,
      setMessages,
      stop,
    ],
  );

  // AI SDK v4 swallows AbortError from stop(), so onError/onFinish never run.
  // Clear the latch here or the next turn keeps the aborted turn's model.
  const handleStop = useCallback(() => {
    pendingRoutedRegistryIdRef.current = null;
    setStreamingRoutedRegistryId(null);
    stop();
  }, [stop]);

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

  const selectedModelInfo = chatModels.find(
    (model) => model.id === selectedModel,
  );

  // Route is the source of truth: selecting history navigates to /chat/:chatId
  // (loader hydrates the transcript) instead of mutating composer state in place.
  const handleSelectChat = useCallback(
    (id: string) => {
      navigate(`/chat/${id}`);
    },
    [navigate],
  );

  // New chat = a clean /chat route (no transcript, no restore).
  const handleNewChat = useCallback(() => {
    navigate("/chat");
  }, [navigate]);

  const historyListProps = {
    chats,
    isLoading: historyLoading,
    error: historyError,
    activeChatId: chatId,
    onSelect: handleSelectChat,
    onNewChat: handleNewChat,
    onRefresh: refreshHistory,
  };

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
          courseCode: selectedCourseCode || undefined,
          adhdAssist,
          streaming: false,
        }),
      });
      const data = await response.json();
      if (data.chatId && !chatId) {
        setChatId(data.chatId);
        if (location.pathname === "/chat") {
          navigate(`/chat/${data.chatId}`, {
            replace: true,
            state: { focusMode: focusModeRef.current, selectedModel },
          });
        }
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
    onStop: handleStop,
    onSelectPrompt: handlePromptSelect,
    isStudentWithCourseChat,
    disabledReason,
    routedModelByMessageId,
    streamingRoutedRegistryId,
    wasAutoRoutedByMessageId,
    streamingWasAutoRouted,
  };

  return (
    <CoreAppShell
      user={user}
      title="Course Chat"
      actions={
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setHistoryOpen((prev) => !prev)}
                aria-label="Open chat history"
                className="h-8 w-8 md:hidden"
              >
                <IconHistory className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Chat history</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      }
      insetClassName="min-h-0 h-svh max-h-svh overflow-hidden"
      mainClassName="flex flex-1 min-h-0 flex-col overflow-hidden"
      providerClassName="h-svh max-h-svh overflow-hidden"
    >
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <ChatHistoryRail {...historyListProps} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ChatCourseScopedView {...sharedViewProps} />
        </div>
      </div>
      <ChatHistoryPanel
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        {...historyListProps}
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
      {isStudentWithCourseChat && (
        <ChatPrivacyNoticeDialog
          open={privacyNoticeOpen}
          onAcknowledge={handlePrivacyNoticeAcknowledge}
        />
      )}
    </CoreAppShell>
  );
}
