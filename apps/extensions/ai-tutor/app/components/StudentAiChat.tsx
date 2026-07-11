import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Badge,
  Button,
  ChatContainerContent,
  ChatContainerRoot,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Loader,
  Message,
  MessageContent,
  PromptInput,
  PromptInputTextarea,
  PromptSuggestion,
  ScrollButton,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@eduai/ui';
import {
  IconAlertCircle,
  IconHistory,
  IconKey,
  IconLoader2,
  IconMessageCircle,
  IconPencilPlus,
  IconSend,
  IconSparkles,
} from '@tabler/icons-react';
import { StudentChatHistoryPanel } from '~/components/StudentChatHistoryPanel';
import { KnowledgeLevelChips } from '~/components/chat/knowledge-level-chips';
import { loadSessionMessages, type ApiChatSession } from '~/lib/student-chat-history';
import { useApiKeys } from '~/hooks/use-api-keys';
import { getProviderFromModelId, getProviderLabel, maskApiKey } from '~/lib/provider-keys';
import { DEFAULT_KNOWLEDGE_LEVEL, knowledgeLevelLabel } from '~/lib/knowledge-levels';
import { cn } from '~/lib/utils';
import api from '../lib/api';
import type { Activity, AiModel, SuggestedPrompt } from '../lib/types';

type ChatTab = 'teach' | 'guide' | 'custom';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type SingleChatState = {
  messages: ChatMessage[];
  input: string;
  loading: boolean;
  chatId: string | null;
};

type ChatState = Record<ChatTab, SingleChatState>;

type TopicOption = { label: string; value: number };

type StudentSelectableModel = AiModel & {
  studentSelectable?: boolean;
  isStudentSelectable?: boolean;
  allowedForStudents?: boolean;
  isAllowed?: boolean;
  availability?: 'allowed' | 'blocked' | 'admin-only';
};

/**
 * Imperative API exposed to parent routes via `forwardRef`.
 * - `sendGuidePrompt`: switch to Guide and submit either the typed input or a
 *   generic fallback. Used after a student answers to nudge the AI toward
 *   guidance. If no provider key is set, it still switches to Guide so the
 *   inline "add a key" notice is visible instead of silently doing nothing.
 * - `pushGuideMessage`: append an assistant message into Guide history without
 *   round-tripping the server (client-authored nudges).
 */
export type StudentAiChatHandle = {
  sendGuidePrompt: () => void;
  pushGuideMessage: (content: string) => void;
};

type StudentAiChatProps = {
  activity: Activity | undefined;
  isUserReady: boolean;
  knowledgeLevel: string | null;
  /** Set the level directly (from the inline chips) — no dialog. */
  onSelectKnowledgeLevel: (level: string) => void;
  /** Open the parent's fuller level picker to change it. */
  onAdjustKnowledgeLevel: () => void;
  topicOptions: TopicOption[];
  currentTopicId: number | null;
  onSelectTopic: (topicId: number) => void;
  studentAnswer: number | string | null;
  /** Extra classes on the root panel — e.g. `h-full` when docked in a
   * resizable split rather than the standalone fixed-height default. */
  className?: string;
};

const DEFAULT_MODEL_ID = 'google:gemini-2.5-flash';

// Detects whether the API has decorated this model with any student-policy field.
function modelHasStudentPolicy(model: StudentSelectableModel): boolean {
  return (
    typeof model.studentSelectable === 'boolean' ||
    typeof model.isStudentSelectable === 'boolean' ||
    typeof model.allowedForStudents === 'boolean' ||
    typeof model.isAllowed === 'boolean' ||
    typeof model.availability === 'string'
  );
}

// Default to true when no policy field is present (admin hasn't restricted this model).
function isStudentSelectableModel(model: StudentSelectableModel): boolean {
  if (typeof model.studentSelectable === 'boolean') return model.studentSelectable;
  if (typeof model.isStudentSelectable === 'boolean') return model.isStudentSelectable;
  if (typeof model.allowedForStudents === 'boolean') return model.allowedForStudents;
  if (typeof model.isAllowed === 'boolean') return model.isAllowed;
  if (typeof model.availability === 'string') return model.availability === 'allowed';
  return true;
}

function getInitialChatState(): ChatState {
  return {
    teach: { messages: [], input: '', loading: false, chatId: null },
    guide: { messages: [], input: '', loading: false, chatId: null },
    custom: { messages: [], input: '', loading: false, chatId: null },
  };
}

const StudentAiChat = forwardRef<StudentAiChatHandle, StudentAiChatProps>(function StudentAiChat(
  {
    activity,
    isUserReady,
    knowledgeLevel,
    onSelectKnowledgeLevel,
    onAdjustKnowledgeLevel,
    topicOptions,
    currentTopicId,
    onSelectTopic,
    studentAnswer,
    className,
  },
  ref,
) {
  const [activeTab, setActiveTab] = useState<ChatTab>('guide');
  const [chatState, setChatState] = useState<ChatState>(() => getInitialChatState());
  const [availableModels, setAvailableModels] = useState<AiModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>(DEFAULT_MODEL_ID);
  const [modelsFetched, setModelsFetched] = useState(false);
  const [modelLoadError, setModelLoadError] = useState(false);
  const [studentModelPolicyActive, setStudentModelPolicyActive] = useState(false);

  // BYOK provider keys are owned by the shared hook (also drives Settings → Providers).
  const { loaded: apiKeysLoaded, getKey, setKey, validateKey } = useApiKeys();
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');
  const [apiKeyValidating, setApiKeyValidating] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);

  const [suggestedPrompts, setSuggestedPrompts] = useState<SuggestedPrompt[]>([]);
  const [promptsDismissed, setPromptsDismissed] = useState<Record<ChatTab, boolean>>({
    teach: false,
    guide: false,
    custom: false,
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    api
      .listSuggestedPrompts()
      .then((prompts) => {
        if (isMounted) setSuggestedPrompts(prompts);
      })
      .catch((err) => {
        console.error('Failed to load suggested prompts:', err);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const currentProvider = getProviderFromModelId(selectedModelId);
  const currentApiKey = getKey(currentProvider);
  const hasApiKey = apiKeysLoaded && Boolean(currentApiKey);

  const clearActiveTabChat = useCallback(() => {
    setActiveChatId(null);
    setChatState((prev) => ({
      ...prev,
      [activeTab]: { messages: [], input: '', loading: false, chatId: null },
    }));
    setPromptsDismissed((prev) => ({ ...prev, [activeTab]: false }));
  }, [activeTab]);

  const handleNewChat = useCallback(() => {
    clearActiveTabChat();
  }, [clearActiveTabChat]);

  const handleRestoreSession = useCallback(
    async (session: ApiChatSession) => {
      setActiveTab(session.mode);
      setActiveChatId(session.chatId);
      setChatState((prev) => ({
        ...prev,
        [session.mode]: { messages: [], input: '', loading: true, chatId: session.chatId },
      }));
      const messages = await loadSessionMessages(activity?.id ?? 0, session.chatId);
      setChatState((prev) => ({
        ...prev,
        [session.mode]: { ...prev[session.mode as ChatTab], messages, loading: false },
      }));
    },
    [activity?.id],
  );

  useEffect(() => {
    const chatId = chatState[activeTab].chatId;
    if (chatId) setActiveChatId(chatId);
  }, [activeTab, chatState]);

  const availableTabs = useMemo<{ value: ChatTab; label: string; tooltip: string }[]>(() => {
    if (!activity) return [];
    const tabs = [];
    if (activity.enableTeachMode) {
      tabs.push({
        value: 'teach' as ChatTab,
        label: 'Teach me',
        tooltip: 'Learn concepts and get explanations about the topic',
      });
    }
    if (activity.enableGuideMode) {
      tabs.push({
        value: 'guide' as ChatTab,
        label: 'Guide me',
        tooltip: 'Get hints and guidance to solve the problem yourself',
      });
    }
    if (activity.enableCustomMode && activity.customPrompt) {
      tabs.push({
        value: 'custom' as ChatTab,
        label: activity.customPromptTitle || 'Custom',
        tooltip:
          activity.customPrompt.slice(0, 100) + (activity.customPrompt.length > 100 ? '...' : ''),
      });
    }
    return tabs;
  }, [activity]);

  const showTabToggle = availableTabs.length > 1;
  const isTeachEnabled = activity?.enableTeachMode ?? false;
  const isGuideEnabled = activity?.enableGuideMode ?? false;
  const isCustomEnabled = (activity?.enableCustomMode && activity?.customPrompt) ?? false;
  const currentTabEnabled =
    (activeTab === 'teach' && isTeachEnabled) ||
    (activeTab === 'guide' && isGuideEnabled) ||
    (activeTab === 'custom' && isCustomEnabled);

  // Auto-correct the active tab during render when enabled modes change. Prefer
  // Guide (hints) as the pedagogical default, then Teach, then Custom.
  if (!currentTabEnabled) {
    if (isGuideEnabled) setActiveTab('guide');
    else if (isTeachEnabled) setActiveTab('teach');
    else if (isCustomEnabled) setActiveTab('custom');
    else if (activeTab !== 'guide') setActiveTab('guide');
  }

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const models = (await api.listAiModels()) as StudentSelectableModel[];
        if (!isMounted) return;
        const policyActive = models.some(modelHasStudentPolicy);
        const selectableModels = policyActive ? models.filter(isStudentSelectableModel) : models;
        setAvailableModels(selectableModels);
        setStudentModelPolicyActive(policyActive);
        setSelectedModelId((current) => {
          if (selectableModels.some((model) => model.modelId === current)) return current;
          const geminiModel = selectableModels.find((model) =>
            model.modelId.includes('gemini-2.5-flash'),
          );
          return geminiModel?.modelId ?? selectableModels[0]?.modelId ?? DEFAULT_MODEL_ID;
        });
        setModelLoadError(false);
      } catch (error) {
        if (!isMounted) return;
        console.error('Failed to load AI models:', error);
        setModelLoadError(true);
        setStudentModelPolicyActive(false);
      } finally {
        if (isMounted) setModelsFetched(true);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  const appendMessage = useCallback(
    (tab: ChatTab, role: ChatMessage['role'], content: string, id?: string) => {
      setChatState((prev) => ({
        ...prev,
        [tab]: {
          ...prev[tab],
          messages: [...prev[tab].messages, { id: id ?? generateMessageId(), role, content }],
        },
      }));
    },
    [],
  );

  const sendChat = useCallback(
    async (tab: ChatTab, overrideMessage?: string) => {
      if (!activity || !isUserReady) return;

      const modeEnabled =
        (tab === 'teach' && activity.enableTeachMode) ||
        (tab === 'guide' && activity.enableGuideMode) ||
        (tab === 'custom' && activity.enableCustomMode && activity.customPrompt);
      if (!modeEnabled) {
        console.warn(`Cannot use disabled ${tab} mode for activity ${activity.id}`);
        return;
      }

      const message = (overrideMessage ?? chatState[tab].input).trim();
      if (!message) return;

      // Provider key is the only hard requirement; a missing knowledge level
      // is filled with a sensible default (and remembered) rather than blocking.
      const provider = getProviderFromModelId(selectedModelId);
      const apiKey = getKey(provider);
      if (!apiKey) {
        setActiveTab(tab);
        return;
      }

      const level = knowledgeLevel ?? DEFAULT_KNOWLEDGE_LEVEL;
      if (!knowledgeLevel) onSelectKnowledgeLevel(DEFAULT_KNOWLEDGE_LEVEL);

      const topicId = typeof currentTopicId === 'number' ? currentTopicId : undefined;
      const normalizedStudentAnswer =
        typeof studentAnswer === 'number'
          ? studentAnswer
          : typeof studentAnswer === 'string' && studentAnswer.trim()
            ? studentAnswer.trim()
            : undefined;

      const messageId = generateMessageId();

      setChatState((prev) => ({
        ...prev,
        [tab]: { ...prev[tab], input: overrideMessage ? prev[tab].input : '', loading: true },
      }));
      setPromptsDismissed((prev) => ({ ...prev, [tab]: true }));
      appendMessage(tab, 'user', message, messageId);

      try {
        const modelId = selectedModelId || DEFAULT_MODEL_ID;
        let response;
        if (tab === 'teach') {
          response = await api.sendTeachMessage(activity.id, {
            knowledgeLevel: level,
            topicId,
            message,
            modelId,
            apiKey,
            chatId: chatState[tab].chatId,
            messageId,
          });
        } else if (tab === 'guide') {
          response = await api.sendGuideMessage(activity.id, {
            knowledgeLevel: level,
            message,
            studentAnswer: normalizedStudentAnswer,
            modelId,
            apiKey,
            chatId: chatState[tab].chatId,
            messageId,
          });
        } else {
          response = await api.sendCustomMessage(activity.id, {
            knowledgeLevel: level,
            topicId,
            message,
            modelId,
            apiKey,
            chatId: chatState[tab].chatId,
            messageId,
          });
        }

        const nextChatId = response.chatId ?? chatState[tab].chatId ?? null;
        if (nextChatId) {
          setChatState((prev) => ({ ...prev, [tab]: { ...prev[tab], chatId: nextChatId } }));
        }
        appendMessage(tab, 'assistant', response.message);
      } catch (error) {
        console.error('AI chat failed:', error);
        appendMessage(
          tab,
          'assistant',
          'AI study buddy not available right now. Please try again later.',
        );
      } finally {
        setChatState((prev) => ({ ...prev, [tab]: { ...prev[tab], loading: false } }));
      }
    },
    [
      activity,
      appendMessage,
      chatState,
      currentTopicId,
      getKey,
      isUserReady,
      knowledgeLevel,
      onSelectKnowledgeLevel,
      selectedModelId,
      studentAnswer,
    ],
  );

  const guideInput = chatState.guide.input;

  useImperativeHandle(
    ref,
    () => ({
      sendGuidePrompt: () => {
        if (!activity || !activity.enableGuideMode) return;
        setActiveTab('guide');
        const provider = getProviderFromModelId(selectedModelId);
        if (!getKey(provider)) return; // notice is already visible in the Guide view
        const fallback = guideInput.trim() || 'I would like guidance on this question.';
        void sendChat('guide', fallback);
      },
      pushGuideMessage: (content: string) => {
        if (!activity || !content || !activity.enableGuideMode) return;
        appendMessage('guide', 'assistant', content);
      },
    }),
    [activity, appendMessage, getKey, guideInput, selectedModelId, sendChat],
  );

  const chatDisabled = !activity || !hasApiKey || !isUserReady;
  const activeChat = chatState[activeTab];
  const canSend = !activeChat.loading && !chatDisabled && Boolean(activeChat.input.trim());

  const currentSuggestedPrompts = useMemo(() => {
    if (activeTab === 'custom') return [];
    return suggestedPrompts.filter((p) => p.mode === activeTab);
  }, [activeTab, suggestedPrompts]);

  const showSuggestedPrompts =
    knowledgeLevel != null &&
    currentSuggestedPrompts.length > 0 &&
    chatState[activeTab].messages.length === 0 &&
    !promptsDismissed[activeTab];

  const handleValueChange = useCallback(
    (value: string) => {
      setChatState((prev) => ({
        ...prev,
        [activeTab]: { ...prev[activeTab], input: value },
      }));
    },
    [activeTab],
  );

  const submitInput = useCallback(() => {
    if (canSend) void sendChat(activeTab);
  }, [activeTab, canSend, sendChat]);

  const handleSuggestedPromptClick = useCallback(
    (text: string) => {
      setChatState((prev) => ({
        ...prev,
        [activeTab]: { ...prev[activeTab], input: text },
      }));
    },
    [activeTab],
  );

  const handleOpenApiKeyDialog = useCallback(() => {
    setTempApiKey(currentApiKey);
    setApiKeyError(null);
    setShowApiKeyDialog(true);
  }, [currentApiKey]);

  const handleSaveApiKeyDialog = useCallback(async () => {
    if (!tempApiKey.trim()) return;
    setApiKeyValidating(true);
    setApiKeyError(null);
    try {
      const result = await validateKey(currentProvider, tempApiKey.trim());
      if (!result.valid) {
        setApiKeyError(result.error || 'Invalid API key');
        return;
      }
      setKey(currentProvider, tempApiKey.trim());
      setShowApiKeyDialog(false);
      setTempApiKey('');
    } catch {
      setApiKeyError('Could not validate API key');
    } finally {
      setApiKeyValidating(false);
    }
  }, [currentProvider, setKey, tempApiKey, validateKey]);

  const showTopicSelect =
    (activeTab === 'teach' ||
      (activeTab === 'custom' && activity?.customPrompt?.includes('[INSERT TOPIC HERE]'))) &&
    topicOptions.length > 1;

  const renderMessages = (tab: ChatTab) =>
    chatState[tab].messages.map((msg) =>
      msg.role === 'user' ? (
        <Message key={msg.id} className="justify-end">
          <MessageContent className="max-w-[80%] bg-primary text-primary-foreground">
            {msg.content}
          </MessageContent>
        </Message>
      ) : (
        <Message key={msg.id}>
          {/* `reading-surface` applies relaxed typography under Assistive Mode. */}
          <MessageContent markdown className="reading-surface max-w-[88%]">
            {msg.content}
          </MessageContent>
        </Message>
      ),
    );

  const activeTabInfo = availableTabs.find((tab) => tab.value === activeTab);

  return (
    <aside
      className={cn(
        'flex h-[700px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card text-card-foreground shadow-[var(--shadow-2xs)]',
        className,
      )}
      data-tour="student-ai-chat"
    >
      {/* Header */}
      <div className="border-b border-border">
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <IconSparkles className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-foreground">AI study buddy</div>
            <div className="text-xs text-muted-foreground">Hints, not answers</div>
          </div>
          {activity && hasApiKey && (
            <TooltipProvider delayDuration={300}>
              <div className="flex shrink-0 items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={handleNewChat}
                      aria-label="New chat"
                    >
                      <IconPencilPlus className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">New chat</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setHistoryOpen((prev) => !prev)}
                      aria-label="Chat history"
                    >
                      <IconHistory className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Chat history</TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          )}
        </div>

        {/* Compact control row: mode + knowledge level (progressive disclosure) */}
        {activity && hasApiKey && (availableTabs.length > 0 || knowledgeLevel) && (
          <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
            {showTabToggle ? (
              <SegmentedControl
                ariaLabel="Chat mode"
                value={activeTab}
                onValueChange={(value) => setActiveTab(value as ChatTab)}
                size="sm"
                options={availableTabs.map((tab) => ({ value: tab.value, label: tab.label }))}
              />
            ) : availableTabs.length === 1 ? (
              <Badge variant="outline" size="lg">
                {availableTabs[0].label}
              </Badge>
            ) : null}

            {knowledgeLevel && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-auto rounded-full"
                onClick={onAdjustKnowledgeLevel}
                aria-label="Change knowledge level"
              >
                {knowledgeLevelLabel(knowledgeLevel)}
              </Button>
            )}
          </div>
        )}

        {activeTabInfo && activity && hasApiKey && (
          <p className="px-5 pb-3 text-xs text-muted-foreground">{activeTabInfo.tooltip}</p>
        )}

        {/* Topic focus (teach / topic-templated custom) */}
        {activity && hasApiKey && showTopicSelect && (
          <div className="space-y-1.5 px-5 pb-4">
            <label className="block text-xs font-semibold text-muted-foreground" htmlFor="ai-chat-topic">
              Focus topic
            </label>
            <Select
              value={currentTopicId === null ? '' : String(currentTopicId)}
              onValueChange={(value) => {
                const numericValue = Number(value);
                if (Number.isFinite(numericValue)) onSelectTopic(numericValue);
              }}
            >
              <SelectTrigger id="ai-chat-topic" className="w-full">
                <SelectValue placeholder="Select a topic" />
              </SelectTrigger>
              <SelectContent>
                {topicOptions.map((topic) => (
                  <SelectItem key={topic.value} value={String(topic.value)}>
                    {topic.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <StudentChatHistoryPanel
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        activityId={activity?.id}
        activeChatId={activeChatId}
        onSelect={(session) => {
          void handleRestoreSession(session);
        }}
        onNewChat={handleNewChat}
      />

      {/* Conversation */}
      <ChatContainerRoot className="relative min-h-0 flex-1">
        <ChatContainerContent className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 py-4">
          {!activity ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary">
                <IconMessageCircle className="h-6 w-6" />
              </div>
              <p className="text-sm text-muted-foreground">Select an activity to begin.</p>
            </div>
          ) : !hasApiKey ? (
            apiKeysLoaded ? (
              <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
                  <IconKey className="h-7 w-7" aria-hidden />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-foreground">
                    Connect an AI provider to start
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Add your {getProviderLabel(currentProvider)} API key to chat with your study
                    buddy. It stays on this device.
                  </p>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <Button type="button" onClick={handleOpenApiKeyDialog}>
                    <IconKey className="mr-1 h-4 w-4" /> Add API key
                  </Button>
                  <Link
                    to="/settings"
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    Manage in Settings → Providers
                  </Link>
                </div>
              </div>
            ) : null
          ) : (
            <>
              {renderMessages(activeTab)}
              {chatState[activeTab].loading && (
                <Message>
                  <div className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-3.5 text-foreground">
                    <Loader variant="loading-dots" text="Thinking" size="sm" />
                  </div>
                </Message>
              )}
              {chatState[activeTab].messages.length === 0 && (
                <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/50 text-accent-foreground">
                    <IconSparkles className="h-6 w-6" />
                  </div>
                  {knowledgeLevel == null ? (
                    <KnowledgeLevelChips value={knowledgeLevel} onSelect={onSelectKnowledgeLevel} />
                  ) : (
                    <>
                      <p className="max-w-[220px] text-sm text-muted-foreground">
                        Ask your study buddy anything about this topic.
                      </p>
                      {showSuggestedPrompts && (
                        <div className="w-full max-w-sm space-y-2">
                          <p className="mb-1 text-xs font-medium text-muted-foreground">Try asking</p>
                          <div className="flex flex-wrap justify-center gap-2">
                            {currentSuggestedPrompts.map((prompt) => (
                              <PromptSuggestion
                                key={prompt.id}
                                type="button"
                                size="sm"
                                onClick={() => handleSuggestedPromptClick(prompt.text)}
                              >
                                {prompt.text}
                              </PromptSuggestion>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </ChatContainerContent>
        <ScrollButton className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-[var(--shadow-sm)]" />
      </ChatContainerRoot>

      {/* Composer */}
      <div className="space-y-2 border-t border-border p-4">
        <div className="overflow-hidden rounded-xl border border-border bg-card focus-within:border-ring">
          <PromptInput
            value={chatState[activeTab].input}
            onValueChange={handleValueChange}
            onSubmit={submitInput}
            isLoading={activeChat.loading}
            className="border-none bg-transparent p-0 shadow-none"
          >
            <PromptInputTextarea
              placeholder={
                chatDisabled
                  ? 'Connect a provider to start chatting'
                  : activeTab === 'teach'
                    ? 'Ask about the topic…'
                    : activeTab === 'guide'
                      ? 'Describe where you need guidance…'
                      : 'Ask a question…'
              }
              disabled={chatDisabled}
              className="max-h-[140px] min-h-[52px] resize-none border-none bg-transparent px-4 py-3.5 text-sm focus-visible:ring-0"
            />
          </PromptInput>

          <div className="flex items-center gap-2 border-t border-border px-2 py-1.5">
            <Select
              value={selectedModelId}
              onValueChange={setSelectedModelId}
              disabled={!availableModels.length}
            >
              <SelectTrigger className="h-8 w-auto gap-1 border-border/60 text-xs" aria-label="Model">
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map((model) => (
                  <SelectItem key={model.id} value={model.modelId}>
                    {model.modelName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex-1" />

            <Button
              type="button"
              size="icon"
              onClick={submitInput}
              disabled={!canSend}
              aria-label="Send message"
            >
              <IconSend className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {modelsFetched && modelLoadError && (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <IconAlertCircle className="h-3.5 w-3.5" />
            Unable to load AI models.
          </div>
        )}
        {modelsFetched && !modelLoadError && !availableModels.length && (
          <div className="text-xs text-muted-foreground">No AI models configured.</div>
        )}
        {modelsFetched &&
          !modelLoadError &&
          studentModelPolicyActive &&
          availableModels.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Tutor model choices are limited by your course configuration.
            </div>
          )}
      </div>

      {/* Add / change provider key */}
      <Dialog open={showApiKeyDialog} onOpenChange={setShowApiKeyDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{getProviderLabel(currentProvider)} API key</DialogTitle>
            <DialogDescription>
              Stored only on this device and sent directly to {getProviderLabel(currentProvider)}.
              You can also manage keys in Settings → Providers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              type="password"
              value={tempApiKey}
              onChange={(e) => {
                setTempApiKey(e.target.value);
                setApiKeyError(null);
              }}
              placeholder={`Enter your ${getProviderLabel(currentProvider)} API key`}
              className="font-mono text-sm"
              aria-invalid={!!apiKeyError}
              autoFocus
              disabled={apiKeyValidating}
            />
            {currentApiKey && (
              <p className="text-xs text-muted-foreground">Current: {maskApiKey(currentApiKey)}</p>
            )}
            {apiKeyError && <p className="text-xs text-destructive">{apiKeyError}</p>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowApiKeyDialog(false);
                setApiKeyError(null);
              }}
              disabled={apiKeyValidating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveApiKeyDialog()}
              disabled={!tempApiKey.trim() || apiKeyValidating}
            >
              {apiKeyValidating ? (
                <>
                  <IconLoader2 className="h-4 w-4 animate-spin" />
                  Validating…
                </>
              ) : (
                'Save'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
});

export default StudentAiChat;

function generateMessageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
