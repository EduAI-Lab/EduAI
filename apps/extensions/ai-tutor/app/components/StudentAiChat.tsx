import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '~/components/ai-elements/conversation';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputModelSelectItem,
  PromptInputModelSelectTrigger,
  PromptInputModelSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from '~/components/ai-elements/prompt-input';
import { Message, MessageContent, MessageResponse } from '~/components/ai-elements/message';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  PromptSuggestion,
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
  IconCheck,
  IconHistory,
  IconKey,
  IconLoader2,
  IconMessageCircle,
  IconPencilPlus,
  IconRefresh,
  IconSparkles,
} from '@tabler/icons-react';
import { StudentChatHistoryPanel } from '~/components/StudentChatHistoryPanel';
import {
  loadSessionMessages,
  type ApiChatSession,
} from '~/lib/student-chat-history';
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
 * - `sendGuidePrompt`: switch to Guide tab and submit either the typed input
 *   or a generic fallback. Used after a student answers a question to nudge
 *   the AI toward giving guidance on what they tried.
 * - `pushGuideMessage`: append an assistant message into Guide history without
 *   round-tripping the server (e.g., system-style nudges authored client-side).
 */
export type StudentAiChatHandle = {
  sendGuidePrompt: () => void;
  pushGuideMessage: (content: string) => void;
};

type StudentAiChatProps = {
  activity: Activity | undefined;
  isUserReady: boolean;
  knowledgeLevel: string | null;
  onRequestKnowledgeLevel: () => void;
  onAdjustKnowledgeLevel: () => void;
  topicOptions: TopicOption[];
  currentTopicId: number | null;
  onSelectTopic: (topicId: number) => void;
  studentAnswer: number | string | null;
};

const DEFAULT_MODEL_ID = 'google:gemini-2.5-flash';
const API_KEYS_STORAGE_KEY = 'ai-provider-keys';
const PROVIDER_LABELS: Record<string, string> = { google: 'Gemini', openai: 'OpenAI' };

// Detects whether the API has decorated this model with any student-policy field.
// Presence of ANY policy field on ANY model flips the whole list into filtered mode.
function modelHasStudentPolicy(model: StudentSelectableModel): boolean {
  return (
    typeof model.studentSelectable === 'boolean' ||
    typeof model.isStudentSelectable === 'boolean' ||
    typeof model.allowedForStudents === 'boolean' ||
    typeof model.isAllowed === 'boolean' ||
    typeof model.availability === 'string'
  );
}

// Multiple legacy field names mean the same thing; check them in priority order.
// Default to true when no policy field is present (admin hasn't restricted this model).
function isStudentSelectableModel(model: StudentSelectableModel): boolean {
  if (typeof model.studentSelectable === 'boolean') return model.studentSelectable;
  if (typeof model.isStudentSelectable === 'boolean') return model.isStudentSelectable;
  if (typeof model.allowedForStudents === 'boolean') return model.allowedForStudents;
  if (typeof model.isAllowed === 'boolean') return model.isAllowed;
  if (typeof model.availability === 'string') return model.availability === 'allowed';
  return true;
}

function getProviderFromModelId(modelId: string): string {
  return modelId.split(':')[0] || 'google';
}

function getProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] || provider;
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return `••••••${key.slice(-4)}`;
}

// localStorage is the only persistence for provider API keys; the server never sees them at rest.
// Read/write are wrapped to survive SSR-like envs and quota errors silently.
function loadApiKeysFromStorage(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(API_KEYS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveApiKeysToStorage(keys: Record<string, string>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Ignore storage errors
  }
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
    onRequestKnowledgeLevel,
    onAdjustKnowledgeLevel,
    topicOptions,
    currentTopicId,
    onSelectTopic,
    studentAnswer,
  },
  ref,
) {
  const [activeTab, setActiveTab] = useState<ChatTab>('teach');
  const [chatState, setChatState] = useState<ChatState>(() => getInitialChatState());
  const [availableModels, setAvailableModels] = useState<AiModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>(DEFAULT_MODEL_ID);
  const [modelsFetched, setModelsFetched] = useState(false);
  const [modelLoadError, setModelLoadError] = useState(false);
  const [studentModelPolicyActive, setStudentModelPolicyActive] = useState(false);

  // API key state
  const [providerApiKeys, setProviderApiKeys] = useState<Record<string, string>>({});
  const [apiKeysLoaded, setApiKeysLoaded] = useState(false);
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');
  const [setupApiKeyInput, setSetupApiKeyInput] = useState('');
  const [apiKeyValidating, setApiKeyValidating] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);

  // Suggested prompts state
  const [suggestedPrompts, setSuggestedPrompts] = useState<SuggestedPrompt[]>([]);
  const [promptsDismissed, setPromptsDismissed] = useState<Record<ChatTab, boolean>>({
    teach: false,
    guide: false,
    custom: false,
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  // Load API keys from localStorage after hydration
  useEffect(() => {
    const stored = loadApiKeysFromStorage();
    setProviderApiKeys(stored);
    setApiKeysLoaded(true);
  }, []);

  // Load suggested prompts
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
  const currentApiKey = providerApiKeys[currentProvider] || '';
  const hasApiKey = apiKeysLoaded && Boolean(currentApiKey);
  const setupComplete = hasApiKey && Boolean(knowledgeLevel);

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

  const handleRefreshChat = useCallback(() => {
    clearActiveTabChat();
  }, [clearActiveTabChat]);

  const handleRestoreSession = useCallback(async (session: ApiChatSession) => {
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
  }, [activity?.id]);

  // Track the active chatId from the current tab's state so the history panel
  // can highlight the active session.
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

  // Auto-correct the active tab during render when the activity's enabled modes change
  // (e.g., instructor disables guide mode while a student is on it). React tolerates
  // these setState calls during render because they converge in one extra pass.
  if (!currentTabEnabled) {
    if (isTeachEnabled) setActiveTab('teach');
    else if (isGuideEnabled) setActiveTab('guide');
    else if (isCustomEnabled) setActiveTab('custom');
    else if (activeTab !== 'teach') setActiveTab('teach');
  }

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const models = (await api.listAiModels()) as StudentSelectableModel[];
        if (!isMounted) return;
        // Filter only when at least one model declares a policy; otherwise show everything (back-compat).
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

  const ensureKnowledgeLevel = useCallback(() => {
    if (!activity) return false;
    if (knowledgeLevel) return true;
    onRequestKnowledgeLevel();
    return false;
  }, [activity, knowledgeLevel, onRequestKnowledgeLevel]);

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
      if (!ensureKnowledgeLevel()) return;

      const level = knowledgeLevel;
      if (!level) return;

      // The provider id is encoded as the prefix of the modelId ("google:gemini-..."); look up its key.
      const provider = getProviderFromModelId(selectedModelId);
      const apiKey = providerApiKeys[provider];
      if (!apiKey) {
        console.warn('No API key for provider:', provider);
        return;
      }

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

      // Dismiss suggested prompts for this tab after first message
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

        // Persist the chatId from the first response so subsequent turns thread into the same AiChatSession.
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
      ensureKnowledgeLevel,
      isUserReady,
      knowledgeLevel,
      providerApiKeys,
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
        const provider = getProviderFromModelId(selectedModelId);
        if (!providerApiKeys[provider]) return;
        const fallback = guideInput.trim() || 'I would like guidance on this question.';
        setActiveTab('guide');
        void sendChat('guide', fallback);
      },
      pushGuideMessage: (content: string) => {
        if (!activity || !content || !activity.enableGuideMode) return;
        appendMessage('guide', 'assistant', content);
      },
    }),
    [activity, appendMessage, guideInput, providerApiKeys, selectedModelId, sendChat],
  );

  const chatDisabled = !activity || !knowledgeLevel || !hasApiKey || !isUserReady;
  const activeChat = chatState[activeTab];
  const canSend =
    !!activeChat && !activeChat.loading && !chatDisabled && Boolean(activeChat.input.trim());

  // Filter suggested prompts for current tab (only teach/guide, not custom)
  const currentSuggestedPrompts = useMemo(() => {
    if (activeTab === 'custom') return [];
    return suggestedPrompts.filter((p) => p.mode === activeTab);
  }, [activeTab, suggestedPrompts]);

  const showSuggestedPrompts =
    setupComplete &&
    currentSuggestedPrompts.length > 0 &&
    chatState[activeTab].messages.length === 0 &&
    !promptsDismissed[activeTab];

  const handlePromptInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setChatState((prev) => ({
        ...prev,
        [activeTab]: { ...prev[activeTab], input: event.target.value },
      }));
    },
    [activeTab],
  );

  const handlePromptSubmit = useCallback(
    (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (canSend && message?.text?.trim()) void sendChat(activeTab);
    },
    [activeTab, canSend, sendChat],
  );

  const handleTextareaKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        if (canSend) void sendChat(activeTab);
      }
    },
    [activeTab, canSend, sendChat],
  );

  const handleSuggestedPromptClick = useCallback(
    (text: string) => {
      setChatState((prev) => ({
        ...prev,
        [activeTab]: { ...prev[activeTab], input: text },
      }));
    },
    [activeTab],
  );

  const handleSetupSaveApiKey = useCallback(async () => {
    if (!setupApiKeyInput.trim()) return;

    setApiKeyValidating(true);
    setApiKeyError(null);

    try {
      const result = await api.validateApiKey(currentProvider, setupApiKeyInput.trim());
      if (!result.valid) {
        setApiKeyError(result.error || 'Invalid API key');
        return;
      }
      const newKeys = { ...providerApiKeys, [currentProvider]: setupApiKeyInput.trim() };
      setProviderApiKeys(newKeys);
      saveApiKeysToStorage(newKeys);
      setSetupApiKeyInput('');
    } catch (err) {
      setApiKeyError('Could not validate API key');
    } finally {
      setApiKeyValidating(false);
    }
  }, [currentProvider, providerApiKeys, setupApiKeyInput]);

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
      const result = await api.validateApiKey(currentProvider, tempApiKey.trim());
      if (!result.valid) {
        setApiKeyError(result.error || 'Invalid API key');
        return;
      }
      const newKeys = { ...providerApiKeys, [currentProvider]: tempApiKey.trim() };
      setProviderApiKeys(newKeys);
      saveApiKeysToStorage(newKeys);
      setShowApiKeyDialog(false);
      setTempApiKey('');
    } catch (err) {
      setApiKeyError('Could not validate API key');
    } finally {
      setApiKeyValidating(false);
    }
  }, [currentProvider, providerApiKeys, tempApiKey]);

  const renderMessages = (tab: ChatTab) => (
    <div className="flex flex-col gap-4">
      {chatState[tab].messages.map((msg) => (
        <Message from={msg.role} key={msg.id}>
          {/* `reading-surface` only applies its relaxed typography under
              Assistive Mode (`[data-assistive]`), and only to the assistant's
              response — that's the primary reading content students consume. */}
          <MessageContent className={msg.role === 'assistant' ? 'reading-surface' : undefined}>
            <MessageResponse>{msg.content}</MessageResponse>
          </MessageContent>
        </Message>
      ))}
    </div>
  );

  const renderSetupCard = () => (
    <Card className="mx-auto w-full max-w-sm space-y-5 p-6 animate-scale-in">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <IconSparkles className="h-7 w-7" aria-hidden />
        </div>
        <h3 className="text-lg font-bold text-foreground">Set up your AI Study Buddy</h3>
        <p className="mt-1 text-xs text-muted-foreground">Complete these steps to start chatting</p>
      </div>

      {/* Step 1: Knowledge level */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
              knowledgeLevel
                ? 'bg-accent text-accent-foreground'
                : 'bg-secondary text-muted-foreground',
            )}
          >
            {knowledgeLevel ? <IconCheck className="h-3.5 w-3.5" /> : '1'}
          </span>
          <span className="text-sm font-semibold text-foreground">Knowledge level</span>
        </div>
        {knowledgeLevel ? (
          <Button
            type="button"
            variant="outline"
            onClick={onAdjustKnowledgeLevel}
            className="w-full justify-between"
          >
            <span className="font-medium">{titleCase(knowledgeLevel)}</span>
            <span className="text-xs text-muted-foreground">Change</span>
          </Button>
        ) : (
          <Button type="button" onClick={onRequestKnowledgeLevel} className="w-full">
            Select your level
          </Button>
        )}
      </div>

      {/* Step 2: API key */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
              hasApiKey ? 'bg-accent text-accent-foreground' : 'bg-secondary text-muted-foreground',
            )}
          >
            {hasApiKey ? <IconCheck className="h-3.5 w-3.5" /> : '2'}
          </span>
          <span className="text-sm font-semibold text-foreground">
            {getProviderLabel(currentProvider)} API key
          </span>
        </div>
        {hasApiKey ? (
          <Button
            type="button"
            variant="outline"
            onClick={handleOpenApiKeyDialog}
            className="w-full justify-between font-mono"
          >
            <span>{maskApiKey(currentApiKey)}</span>
            <span className="font-sans text-xs text-muted-foreground">Change</span>
          </Button>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="password"
                value={setupApiKeyInput}
                onChange={(e) => {
                  setSetupApiKeyInput(e.target.value);
                  setApiKeyError(null);
                }}
                placeholder="Enter API key"
                className="flex-1 font-mono text-sm"
                aria-invalid={!!apiKeyError}
                disabled={apiKeyValidating}
              />
              <Button
                type="button"
                onClick={handleSetupSaveApiKey}
                disabled={!setupApiKeyInput.trim() || apiKeyValidating}
              >
                {apiKeyValidating ? (
                  <>
                    <IconLoader2 className="h-4 w-4 animate-spin" />
                    <span className="sr-only">Saving…</span>
                  </>
                ) : (
                  'Save'
                )}
              </Button>
            </div>
            {apiKeyError && <p className="pl-1 text-xs text-destructive">{apiKeyError}</p>}
          </div>
        )}
      </div>
    </Card>
  );

  const activeTabInfo = availableTabs.find((tab) => tab.value === activeTab);

  return (
    <aside
      className="flex h-[700px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card text-card-foreground shadow-[var(--shadow-2xs)]"
      data-tour="student-ai-chat"
    >
      {/* Header */}
      <div className="border-b border-border">
        <div className={cn('flex items-center gap-3 px-5', setupComplete ? 'pb-3 pt-5' : 'py-5')}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <IconSparkles className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-foreground">AI Study Buddy</div>
            <div className="text-xs text-muted-foreground">Hints, not answers</div>
          </div>
          {setupComplete && (
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
                      variant="ghost"
                      size="icon"
                      onClick={handleRefreshChat}
                      aria-label="Refresh chat"
                    >
                      <IconRefresh className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Refresh chat</TooltipContent>
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

        {setupComplete && (
          <div className="flex flex-wrap items-center gap-2 px-5 pb-5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={onAdjustKnowledgeLevel}
              aria-label="Change knowledge level"
            >
              {titleCase(knowledgeLevel!)}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full font-mono"
              onClick={handleOpenApiKeyDialog}
              aria-label={`Edit ${getProviderLabel(currentProvider)} API key`}
            >
              <IconKey className="h-3.5 w-3.5" />
              {maskApiKey(currentApiKey)}
            </Button>
          </div>
        )}
      </div>
      <StudentChatHistoryPanel
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        activityId={activity?.id}
        activeChatId={activeChatId}
        onSelect={(session) => { void handleRestoreSession(session); }}
        onNewChat={handleNewChat}
      />

      {/* Mode switcher + topic selector */}
      {setupComplete && (availableTabs.length > 0 || topicOptions.length > 1) && (
        <div className="space-y-4 px-5 pt-5">
          {availableTabs.length > 0 && (
            <div className="space-y-1.5">
              {showTabToggle ? (
                <SegmentedControl
                  ariaLabel="Chat mode"
                  value={activeTab}
                  onValueChange={setActiveTab}
                  size="sm"
                  options={availableTabs.map((tab) => ({ value: tab.value, label: tab.label }))}
                />
              ) : (
                <Badge variant="outline" size="lg">
                  {availableTabs[0].label}
                </Badge>
              )}
              {activeTabInfo && (
                <p className="text-xs text-muted-foreground">{activeTabInfo.tooltip}</p>
              )}
            </div>
          )}

          {/* Topic selector for teach mode and custom mode (when prompt uses topic placeholder) */}
          {(activeTab === 'teach' ||
            (activeTab === 'custom' && activity?.customPrompt?.includes('[INSERT TOPIC HERE]'))) &&
            topicOptions.length > 1 && (
              <div className="space-y-1.5">
                <label
                  className="block text-xs font-semibold text-muted-foreground"
                  htmlFor="ai-chat-topic"
                >
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
      )}

      {/* Conversation area */}
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-[var(--chat-max-width)] px-5 py-4">
          {!activity ? (
            <ConversationEmptyState
              icon={
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary">
                  <IconMessageCircle className="h-6 w-6" />
                </div>
              }
              title="No activity selected"
              description="Select an activity to begin."
            />
          ) : !setupComplete ? (
            renderSetupCard()
          ) : (
            <>
              {renderMessages(activeTab)}
              {chatState[activeTab].loading && (
                <Message from="assistant" className="mt-4">
                  <MessageContent className="flex-row items-center gap-2 py-3.5">
                    <span className="flex gap-1" aria-hidden>
                      <span className="h-2 w-2 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                    </span>
                    <span className="text-xs text-muted-foreground">Thinking…</span>
                  </MessageContent>
                </Message>
              )}
              {chatState[activeTab].messages.length === 0 && (
                <ConversationEmptyState>
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/50 text-accent-foreground">
                    <IconSparkles className="h-6 w-6" />
                  </div>
                  <p className="max-w-[220px] text-sm text-muted-foreground">
                    Ask your study buddy anything about this topic.
                  </p>

                  {/* Suggested prompts */}
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
                </ConversationEmptyState>
              )}
            </>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Input area */}
      <div className="space-y-3 border-t border-border p-4">
        <PromptInput
          onSubmit={handlePromptSubmit}
          className="[&_[data-slot=input-group]]:rounded-xl [&_[data-slot=input-group]]:border-border [&_[data-slot=input-group]]:bg-card"
        >
          <PromptInputBody>
            <PromptInputTextarea
              value={chatState[activeTab].input}
              onChange={handlePromptInputChange}
              onKeyDown={handleTextareaKeyDown}
              placeholder={
                chatDisabled
                  ? 'Complete setup above to start chatting'
                  : activeTab === 'teach'
                    ? 'Ask about the topic…'
                    : activeTab === 'guide'
                      ? 'Describe where you need guidance…'
                      : 'Ask a question…'
              }
              disabled={chatDisabled}
              className="px-4 pb-3 pt-4 text-sm"
            />
          </PromptInputBody>
          <PromptInputFooter className="border-t border-border px-4 pb-3 pt-3">
            <PromptInputTools className="flex items-center gap-2">
              <PromptInputModelSelect
                value={selectedModelId}
                onValueChange={setSelectedModelId}
                disabled={!availableModels.length}
              >
                <PromptInputModelSelectTrigger size="sm" className="min-w-[140px] text-xs">
                  <PromptInputModelSelectValue placeholder="Select model" />
                </PromptInputModelSelectTrigger>
                <PromptInputModelSelectContent>
                  {availableModels.map((model) => (
                    <PromptInputModelSelectItem key={model.id} value={model.modelId}>
                      {model.modelName}
                    </PromptInputModelSelectItem>
                  ))}
                </PromptInputModelSelectContent>
              </PromptInputModelSelect>
            </PromptInputTools>
            <PromptInputSubmit
              disabled={!canSend}
              status={activeChat.loading ? 'streaming' : 'ready'}
            />
          </PromptInputFooter>
        </PromptInput>

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

      {/* API key edit dialog */}
      <Dialog open={showApiKeyDialog} onOpenChange={setShowApiKeyDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{getProviderLabel(currentProvider)} API key</DialogTitle>
            <DialogDescription>
              Update your API key for {getProviderLabel(currentProvider)} models.
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
              onClick={handleSaveApiKeyDialog}
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

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
