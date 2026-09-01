import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import { Spinner } from "@eduai/ui";
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
  MarkdownStylesProvider,
  type MarkdownStyles,
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
} from "@eduai/ui";
import {
  IconAlertCircle,
  IconHistory,
  IconKey,
  IconMessageCircle,
  IconPencilPlus,
  IconPlayerStop,
  IconSend,
  IconSparkles,
} from "@tabler/icons-react";
import { normalizeMathMarkdown } from "@eduai/ui/math-markdown";
import { StudentChatHistoryPanel } from "~/components/StudentChatHistoryPanel";
import { KnowledgeLevelChips } from "~/components/chat/knowledge-level-chips";
import { loadSessionMessages, type ApiChatSession } from "~/lib/student-chat-history";
import { useApiKeys } from "~/hooks/use-api-keys";
import {
  getProviderFromModelId,
  getProviderLabel,
  maskApiKey,
  providerRequiresByokKey,
} from "~/lib/provider-keys";
import { DEFAULT_KNOWLEDGE_LEVEL, knowledgeLevelLabel } from "~/lib/knowledge-levels";
import { z } from "zod";
import { cn } from "~/lib/utils";
import api, { ApiHttpError, ApiTimeoutError } from "../lib/api";
import type { Activity, AiModel, SuggestedPrompt } from "../lib/types";
// Streamdown's vendor CSS, scoped to this chunk instead of the global sheet
// (#1343, following Core's #1222 seam). KaTeX is loaded on demand instead --
// see MARKDOWN_STYLES below.
import "~/styles/chat-markdown.css";
import { randomId } from "@eduai/ui/runtime-env";

/**
 * KaTeX's stylesheet is loaded on demand, only for messages that actually
 * contain math (#1342). Module-level so its identity is stable — the shared
 * markdown renderer caches a Streamdown variant per loader.
 */
const MARKDOWN_STYLES: MarkdownStyles = {
  loadKatexStyles: () => import("katex/dist/katex.min.css"),
};

type ChatTab = "teach" | "guide" | "custom";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type SingleChatState = {
  messages: ChatMessage[];
  input: string;
  loading: boolean;
  chatId: string | null;
};

type ChatState = Record<ChatTab, SingleChatState>;

type TopicOption = { label: string; value: string | number };

type StudentSelectableModel = AiModel & {
  studentSelectable?: boolean;
  isStudentSelectable?: boolean;
  allowedForStudents?: boolean;
  isAllowed?: boolean;
  availability?: "allowed" | "blocked" | "admin-only";
  isDefaultTutor?: boolean;
};

/**
 * Imperative API exposed to parent routes via `forwardRef`.
 * - `sendGuidePrompt`: switch to Guide and submit either the typed input or a
 *   generic fallback. Used after a student answers to nudge the AI toward
 *   guidance. If no provider key is set, it still switches to Guide so the
 *   inline "add a key" notice is visible instead of silently doing nothing.
 */
export type StudentAiChatHandle = {
  sendGuidePrompt: () => void;
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
  currentTopicId: string | number | null;
  onSelectTopic: (topicId: string | number) => void;
  studentAnswer: number | string | null;
  /**
   * Study-buddy availability, gated on the caller's resolved per-course role
   * (#1626). The tutoring routes (`/teach`, `/guide`, `/custom`) and chat-session
   * listing 403 any non-STUDENT enrollment, so a course TA's composer would be a
   * dead control. Fails closed on the same signal as the answer-card Submit:
   * `"allowed"` only once the per-course role resolves to STUDENT; `"pending"`
   * while the breadcrumb that carries it is in flight; `"unverified"` if that
   * breadcrumb failed; `"withheld"` once a non-STUDENT role resolves. For every
   * non-`"allowed"` state the panel shows a short notice in place of the connect
   * state / conversation and the composer is withheld entirely — so a TA with a
   * BYOK key can't drive a dead composer during the unresolved-role window.
   */
  studyBuddyState?: "allowed" | "pending" | "unverified" | "withheld";
  /** Extra classes on the root panel — e.g. `h-full` when docked in a
   * resizable split rather than the standalone fixed-height default. */
  className?: string;
  /**
   * #1660: true when the parent route resolved the viewer as an
   * ADMIN/UNIT_ADMIN/INSTRUCTOR previewing the learner experience (its
   * `previewRole`), not an enrolled STUDENT/TA. Threaded through so a 403
   * from AI tutoring can be attributed to "this is a preview" only for an
   * actual previewer — this component has no role info of its own.
   */
  isPreview?: boolean;
};

// Last-resort fallback for when the /ai-models call itself fails and no
// catalog is available at all. The real default lives server-side (see
// `aiModelPolicy.js` DEFAULT_TUTOR_MODEL) and is surfaced per-model via the
// `isDefaultTutor` flag on each /ai-models entry — prefer that over this.
const DEFAULT_MODEL_ID = "google:gemini-2.5-flash";

/**
 * The boolean spellings of "may a student pick this model", in precedence
 * order. They accumulated as the /ai-models contract changed and any given
 * deployment sends at most one, so the first field actually present wins.
 */
const STUDENT_POLICY_FLAGS = [
  "studentSelectable",
  "isStudentSelectable",
  "allowedForStudents",
  "isAllowed",
] as const satisfies readonly (keyof StudentSelectableModel)[];

function studentPolicyFlag(model: StudentSelectableModel): boolean | undefined {
  for (const key of STUDENT_POLICY_FLAGS) {
    // Only an actual boolean counts as a decision: `/ai-models` carries these
    // four spellings through unvalidated, and a `null` there means "not
    // configured", not "blocked".
    const value = model[key];
    if (value === true || value === false) return value;
  }
  return undefined;
}

/** `availability` counts only when the API actually sent a string; a `null` or a
 * non-string there is "not configured", the same as an absent field. */
function hasAvailability(model: StudentSelectableModel): boolean {
  return z.string().safeParse(model.availability).success;
}

// Detects whether the API has decorated this model with any student-policy field.
function modelHasStudentPolicy(model: StudentSelectableModel): boolean {
  return studentPolicyFlag(model) !== undefined || hasAvailability(model);
}

// Default to true when no policy field is present (admin hasn't restricted this model).
function isStudentSelectableModel(model: StudentSelectableModel): boolean {
  const flag = studentPolicyFlag(model);
  if (flag !== undefined) return flag;
  if (hasAvailability(model)) return model.availability === "allowed";
  return true;
}

function getInitialChatState() {
  return {
    teach: { messages: [], input: "", loading: false, chatId: null },
    guide: { messages: [], input: "", loading: false, chatId: null },
    custom: { messages: [], input: "", loading: false, chatId: null },
  } satisfies ChatState;
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
    studyBuddyState = "allowed",
    className,
    isPreview,
  },
  ref,
) {
  // Any non-allowed state withholds the composer entirely (not merely disables
  // it) and drives the notice below — fails closed on the unresolved-role
  // window as well as a resolved TA (#1626).
  const studyBuddyWithheld = studyBuddyState !== "allowed";
  const [activeTab, setActiveTab] = useState<ChatTab>("guide");
  const [chatState, setChatState] = useState<ChatState>(() => getInitialChatState());
  const [availableModels, setAvailableModels] = useState<AiModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>(DEFAULT_MODEL_ID);
  const [modelsFetched, setModelsFetched] = useState(false);
  const [modelLoadError, setModelLoadError] = useState(false);
  const [studentModelPolicyActive, setStudentModelPolicyActive] = useState(false);

  // BYOK provider keys are owned by the shared hook (also drives Settings → Providers).
  const { keys: providerKeys, loaded: apiKeysLoaded, getKey, setKey, validateKey } = useApiKeys();
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [tempApiKey, setTempApiKey] = useState("");
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

  // #999: one in-flight AbortController per tab so a "Stop generating" click
  // (or a tab switch away mid-request) can cancel that tab's request without
  // touching the others.
  const abortControllersRef = useRef<Partial<Record<ChatTab, AbortController>>>({});

  // Invalidates in-flight session restores (PR #1023 review): bumped by every
  // new restore and by "New chat", so a stale completion — e.g. session A
  // failing after session B already restored, or after the user started a
  // fresh chat — can't overwrite the tab's newer state.
  const restoreSeqRef = useRef(0);

  useEffect(() => {
    let isMounted = true;
    api
      .listSuggestedPrompts()
      .then((prompts) => {
        if (isMounted) setSuggestedPrompts(prompts);
      })
      .catch((err) => {
        console.error("Failed to load suggested prompts:", err);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const currentProvider = getProviderFromModelId(selectedModelId);
  const currentApiKey = getKey(currentProvider);
  const hasApiKey = apiKeysLoaded && Boolean(currentApiKey);

  // #1645: a BYOK key is a fallback, not a precondition. The selected model is
  // usable when it is UBC-hosted (server key covers it) OR the student holds a
  // key for its BYOK provider. Only a BYOK model with no key blocks the
  // composer and shows the "connect a provider" empty state.
  const selectedModelRequiresKey = providerRequiresByokKey(currentProvider);
  const modelUsable = !selectedModelRequiresKey || hasApiKey;

  const clearActiveTabChat = useCallback(() => {
    restoreSeqRef.current += 1;
    setActiveChatId(null);
    setChatState((prev) => ({
      ...prev,
      [activeTab]: { messages: [], input: "", loading: false, chatId: null },
    }));
    setPromptsDismissed((prev) => ({ ...prev, [activeTab]: false }));
  }, [activeTab]);

  const handleNewChat = useCallback(() => {
    clearActiveTabChat();
  }, [clearActiveTabChat]);

  useEffect(() => {
    const chatId = chatState[activeTab].chatId;
    if (chatId) setActiveChatId(chatId);
  }, [activeTab, chatState]);

  const availableTabs = useMemo<{ value: ChatTab; label: string; tooltip: string }[]>(() => {
    if (!activity) return [];
    const tabs = [];
    if (activity.enableTeachMode) {
      tabs.push({
        value: "teach" as ChatTab,
        label: "Teach me",
        tooltip: "Learn concepts and get explanations about the topic",
      });
    }
    if (activity.enableGuideMode) {
      tabs.push({
        value: "guide" as ChatTab,
        label: "Guide me",
        tooltip: "Get hints and guidance to solve the problem yourself",
      });
    }
    if (activity.enableCustomMode && activity.customPrompt) {
      tabs.push({
        value: "custom" as ChatTab,
        label: activity.customPromptTitle || "Custom",
        tooltip:
          activity.customPrompt.slice(0, 100) + (activity.customPrompt.length > 100 ? "..." : ""),
      });
    }
    return tabs;
  }, [activity]);

  const showTabToggle = availableTabs.length > 1;
  const isTeachEnabled = activity?.enableTeachMode ?? false;
  const isGuideEnabled = activity?.enableGuideMode ?? false;
  const isCustomEnabled = (activity?.enableCustomMode && activity?.customPrompt) ?? false;
  const currentTabEnabled =
    (activeTab === "teach" && isTeachEnabled) ||
    (activeTab === "guide" && isGuideEnabled) ||
    (activeTab === "custom" && isCustomEnabled);

  // Auto-correct the active tab during render when enabled modes change. Prefer
  // Guide (hints) as the pedagogical default, then Teach, then Custom.
  if (!currentTabEnabled) {
    if (isGuideEnabled) setActiveTab("guide");
    else if (isTeachEnabled) setActiveTab("teach");
    else if (isCustomEnabled) setActiveTab("custom");
    else if (activeTab !== "guide") setActiveTab("guide");
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
          const defaultModel = selectableModels.find((model) => model.isDefaultTutor);
          return defaultModel?.modelId ?? selectableModels[0]?.modelId ?? DEFAULT_MODEL_ID;
        });
        setModelLoadError(false);
      } catch (error) {
        if (!isMounted) return;
        console.error("Failed to load AI models:", error);
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

  // #1645: the model picker offers exactly the admin-allowed tutor catalog. A
  // held BYOK key never adds models the admin left off the allow-list — the
  // allow-list is absolute. A personal key is a fallback (UBC-hosted models
  // serve without one, and Core falls back to a keyed provider when the fleet
  // is down), not a way to pick a model policy forbids.
  const pickerModels = availableModels as StudentSelectableModel[];

  const appendMessage = useCallback(
    (tab: ChatTab, role: ChatMessage["role"], content: string, id?: string) => {
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

  const handleRestoreSession = useCallback(
    async (session: ApiChatSession) => {
      const seq = ++restoreSeqRef.current;
      const tab = session.mode;
      setActiveTab(tab);
      setActiveChatId(session.chatId);
      setChatState((prev) => ({
        ...prev,
        [tab]: { messages: [], input: "", loading: true, chatId: session.chatId },
      }));
      try {
        const messages = await loadSessionMessages(activity?.id ?? 0, session.chatId);
        if (seq !== restoreSeqRef.current) return;
        setChatState((prev) => ({
          ...prev,
          [tab]: { ...prev[tab], messages, loading: false },
        }));
      } catch (error) {
        if (seq !== restoreSeqRef.current) return;
        console.error("Failed to restore chat session:", error);
        // Drop the failed session's chatId too — otherwise the user could keep
        // chatting into a history that never loaded.
        setActiveChatId(null);
        setChatState((prev) => ({
          ...prev,
          [tab]: { ...prev[tab], messages: [], loading: false, chatId: null },
        }));
        appendMessage(
          tab,
          "assistant",
          "Couldn't load this conversation. Please open chat history and try again.",
        );
      }
    },
    [activity?.id, appendMessage],
  );

  const sendChat = useCallback(
    async (tab: ChatTab, overrideMessage?: string) => {
      if (!activity || !isUserReady) return;

      // #1626: hard send boundary. The composer is withheld in the UI for any
      // non-STUDENT / unresolved course role, but the imperative
      // `sendGuidePrompt` handle exposed to the parent route bypasses the UI —
      // block it here too so a TA (or an unresolved role) never issues a tutor
      // turn the server would 403.
      if (studyBuddyWithheld) return;

      // #998: guard against duplicate concurrent requests for this tab. The
      // manual submit path is already gated by `canSend` (which checks
      // `loading`), but the imperative `sendGuidePrompt` handle exposed to
      // the parent route bypasses that — this guard is the single choke
      // point both paths funnel through.
      if (chatState[tab].loading || abortControllersRef.current[tab]) return;

      const modeEnabled =
        (tab === "teach" && activity.enableTeachMode) ||
        (tab === "guide" && activity.enableGuideMode) ||
        (tab === "custom" && activity.enableCustomMode && activity.customPrompt);
      if (!modeEnabled) {
        console.warn(`Cannot use disabled ${tab} mode for activity ${activity.id}`);
        return;
      }

      const message = (overrideMessage ?? chatState[tab].input).trim();
      if (!message) return;

      // #1645: a BYOK key is required only when the selected model is served by
      // a BYOK provider. UBC-hosted models (vllm/ollama) are covered by the
      // server key, so they send with no personal key. A missing knowledge
      // level is filled with a sensible default rather than blocking.
      const provider = getProviderFromModelId(selectedModelId);
      const apiKey = getKey(provider);
      if (providerRequiresByokKey(provider) && !apiKey) {
        setActiveTab(tab);
        return;
      }
      const forwardedApiKey = apiKey || undefined;

      // #1645: forward every BYOK key the student holds — not only the selected
      // model's — so Core can fall back to another keyed provider when the UBC
      // fleet is down. A keyless UBC send still validates (the map is optional).
      const heldApiKeys = Object.fromEntries(
        Object.entries(providerKeys).filter(([, value]) => Boolean(value)),
      );
      const forwardedApiKeys = Object.keys(heldApiKeys).length ? heldApiKeys : undefined;

      const level = knowledgeLevel ?? DEFAULT_KNOWLEDGE_LEVEL;
      if (!knowledgeLevel) onSelectKnowledgeLevel(DEFAULT_KNOWLEDGE_LEVEL);

      const topicId = currentTopicId ?? undefined;
      const answerText = z.string().safeParse(studentAnswer);
      const normalizedStudentAnswer = answerText.success
        ? answerText.data.trim() || undefined
        : (z.number().safeParse(studentAnswer).data ?? undefined);

      const messageId = generateMessageId();

      const controller = new AbortController();
      abortControllersRef.current[tab] = controller;

      setChatState((prev) => ({
        ...prev,
        [tab]: { ...prev[tab], input: overrideMessage ? prev[tab].input : "", loading: true },
      }));
      setPromptsDismissed((prev) => ({ ...prev, [tab]: true }));
      appendMessage(tab, "user", message, messageId);

      try {
        const modelId = selectedModelId || DEFAULT_MODEL_ID;
        let response;
        if (tab === "teach") {
          response = await api.sendTeachMessage(
            activity.id,
            {
              knowledgeLevel: level,
              topicId,
              message,
              modelId,
              apiKey: forwardedApiKey,
              apiKeys: forwardedApiKeys,
              chatId: chatState[tab].chatId,
              messageId,
            },
            controller.signal,
          );
        } else if (tab === "guide") {
          response = await api.sendGuideMessage(
            activity.id,
            {
              knowledgeLevel: level,
              message,
              studentAnswer: normalizedStudentAnswer,
              modelId,
              apiKey: forwardedApiKey,
              apiKeys: forwardedApiKeys,
              chatId: chatState[tab].chatId,
              messageId,
            },
            controller.signal,
          );
        } else {
          response = await api.sendCustomMessage(
            activity.id,
            {
              knowledgeLevel: level,
              topicId,
              message,
              modelId,
              apiKey: forwardedApiKey,
              apiKeys: forwardedApiKeys,
              chatId: chatState[tab].chatId,
              messageId,
            },
            controller.signal,
          );
        }

        const nextChatId = response.chatId ?? chatState[tab].chatId ?? null;
        if (nextChatId) {
          setChatState((prev) => ({ ...prev, [tab]: { ...prev[tab], chatId: nextChatId } }));
        }
        appendMessage(tab, "assistant", response.message);
      } catch (error) {
        if (controller.signal.aborted && !(error instanceof ApiTimeoutError)) {
          // User clicked Stop — the in-progress turn is simply dropped, no
          // error bubble (matches Core's stop-generating behavior).
        } else if (error instanceof ApiTimeoutError) {
          console.error("AI chat timed out:", error);
          appendMessage(tab, "assistant", "That took too long to respond. Please try again.");
        } else {
          console.error("AI chat failed:", error);
          // #1660 review (ariqmuldi): the server 403s these endpoints for
          // three distinct reasons (server/src/routes/activities.js) — a
          // non-STUDENT caller (a previewer, what this message is about), a
          // real student whose enrollment-sync is lagging, or content that
          // got unpublished mid-session. Gating on the `isPreview` prop
          // (the parent route's already-resolved role, not this
          // component's business to re-derive) instead of the bare status
          // code keeps a genuine STUDENT/TA from seeing "this is a
          // read-only preview" for one of the other two, unrelated 403s.
          appendMessage(
            tab,
            "assistant",
            error instanceof ApiHttpError && error.status === 403 && isPreview
              ? "AI tutoring is only available to enrolled students — this is a read-only preview."
              : "AI study buddy not available right now. Please try again later.",
          );
        }
      } finally {
        if (abortControllersRef.current[tab] === controller) {
          delete abortControllersRef.current[tab];
          setChatState((prev) => ({ ...prev, [tab]: { ...prev[tab], loading: false } }));
        }
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
      studyBuddyWithheld,
      // #1667 review (Whiteknight07): sendChat reads isPreview in the 403
      // branch; omitting it here would keep a stale closure across an
      // AuthProvider role change on a still-mounted lesson.
      isPreview,
    ],
  );

  const guideInput = chatState.guide.input;

  useImperativeHandle(
    ref,
    () => ({
      sendGuidePrompt: () => {
        if (!activity || !activity.enableGuideMode) return;
        setActiveTab("guide");
        const provider = getProviderFromModelId(selectedModelId);
        // Only a BYOK model with no key blocks here; UBC-hosted models send
        // with the server key. When it does block, the "add a key" notice is
        // already visible in the Guide view (#1645).
        if (providerRequiresByokKey(provider) && !getKey(provider)) return;
        const fallback = guideInput.trim() || "I would like guidance on this question.";
        void sendChat("guide", fallback);
      },
    }),
    [activity, getKey, guideInput, selectedModelId, sendChat],
  );

  const chatDisabled = !activity || !modelUsable || !isUserReady || studyBuddyWithheld;
  const activeChat = chatState[activeTab];
  const canSend = !activeChat.loading && !chatDisabled && Boolean(activeChat.input.trim());

  const currentSuggestedPrompts = useMemo(() => {
    if (activeTab === "custom") return [];
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

  // #999: lets the composer's stop control cancel the active tab's in-flight
  // request (aborts the fetch in api.ts; sendChat's catch treats an
  // already-aborted controller as a silent cancel, not an error).
  const handleStop = useCallback(() => {
    abortControllersRef.current[activeTab]?.abort();
  }, [activeTab]);

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
      let result: { valid: boolean; error?: string };
      try {
        result = await validateKey(currentProvider, tempApiKey.trim());
      } catch {
        setApiKeyError("Could not validate API key");
        return;
      }
      if (!result.valid) {
        setApiKeyError(result.error || "Invalid API key");
        return;
      }
      try {
        await setKey(currentProvider, tempApiKey.trim());
      } catch {
        setApiKeyError("Could not save API key");
        return;
      }
      setShowApiKeyDialog(false);
      setTempApiKey("");
    } finally {
      setApiKeyValidating(false);
    }
  }, [currentProvider, setKey, tempApiKey, validateKey]);

  const showTopicSelect =
    (activeTab === "teach" ||
      (activeTab === "custom" && activity?.customPrompt?.includes("[INSERT TOPIC HERE]"))) &&
    topicOptions.length > 1;

  const renderMessages = (tab: ChatTab) =>
    chatState[tab].messages.map((msg) =>
      msg.role === "user" ? (
        <Message key={msg.id} className="justify-end">
          <MessageContent className="max-w-[80%] bg-primary text-primary-foreground">
            {msg.content}
          </MessageContent>
        </Message>
      ) : (
        <Message key={msg.id}>
          {/* Match Core's chat: render AI markdown directly on the card (bg-transparent)
              instead of the default bg-secondary bubble, which broke dark-mode contrast.
              MessageContent applies `reading-surface` internally for Assistive Mode.

              Assistant output is normalized first (#1401) so model LaTeX reaches
              KaTeX in the delimiters remark-math accepts — same split Core uses in
              components/chat/chat-message.tsx. User-typed text stays verbatim. */}
          <MarkdownStylesProvider value={MARKDOWN_STYLES}>
            <MessageContent markdown className="max-w-[88%] bg-transparent p-0 text-foreground">
              {normalizeMathMarkdown(msg.content)}
            </MessageContent>
          </MarkdownStylesProvider>
        </Message>
      ),
    );

  const activeTabInfo = availableTabs.find((tab) => tab.value === activeTab);

  return (
    <aside
      className={cn(
        "flex h-[700px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card text-card-foreground shadow-[var(--shadow-2xs)]",
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
          {activity && modelUsable && !studyBuddyWithheld && (
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
        {activity &&
          modelUsable &&
          !studyBuddyWithheld &&
          (availableTabs.length > 0 || knowledgeLevel) && (
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

        {activeTabInfo && activity && modelUsable && !studyBuddyWithheld && (
          <p className="px-5 pb-3 text-xs text-muted-foreground">{activeTabInfo.tooltip}</p>
        )}

        {/* Topic focus (teach / topic-templated custom) */}
        {activity && modelUsable && !studyBuddyWithheld && showTopicSelect && (
          <div className="space-y-1.5 px-5 pb-4">
            <label
              className="block text-xs font-semibold text-muted-foreground"
              htmlFor="ai-chat-topic"
            >
              Focus topic
            </label>
            <Select
              value={currentTopicId === null ? "" : String(currentTopicId)}
              onValueChange={(value) => {
                // Options are keyed by `String(topic.value)`, so map the
                // selected key back to the option's own id rather than
                // coercing it: topic ids are cuid strings, and `Number()`
                // turned every real one into `NaN` and dropped the selection.
                const selected = topicOptions.find((topic) => String(topic.value) === value);
                if (selected) onSelectTopic(selected.value);
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
          ) : studyBuddyWithheld ? (
            // #1626: the tutoring routes 403 a non-STUDENT enrollment, so the
            // composer would be a dead control for a course TA — and equally so
            // while the per-course role is still unresolved. Show why instead —
            // mirroring the withheld-Submit note on the answer card — rather than
            // the connect state or a live composer. The message tracks the gate
            // state so a genuine student sees a transient "checking access"
            // rather than the TA notice during the breadcrumb window.
            <div
              role="note"
              className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-3 py-10 text-center"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                <IconSparkles className="h-6 w-6" aria-hidden />
              </div>
              <p className="text-sm text-muted-foreground">
                {studyBuddyState === "pending"
                  ? "Checking your access…"
                  : studyBuddyState === "unverified"
                    ? "Couldn't verify your access. Reload to try again."
                    : "The AI study buddy is available to students enrolled in this course."}
              </p>
            </div>
          ) : !modelUsable ? (
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
                  {/* Mirror Core's ChatTypingIndicator: subtle bg-muted/50 bubble + text-shimmer. */}
                  <div className="max-w-none rounded-lg bg-muted/50 px-4 py-3 text-foreground">
                    <Loader
                      variant="text-shimmer"
                      text="Thinking"
                      size="sm"
                      className="text-muted-foreground"
                    />
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
                          <p className="mb-1 text-xs font-medium text-muted-foreground">
                            Try asking
                          </p>
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

      {/* Composer — withheld entirely for a non-STUDENT course role (#1626); the
          body shows the withheld notice instead of a dead, disabled input. */}
      {!studyBuddyWithheld && (
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
                    ? "Connect a provider to start chatting"
                    : activeTab === "teach"
                      ? "Ask about the topic…"
                      : activeTab === "guide"
                        ? "Describe where you need guidance…"
                        : "Ask a question…"
                }
                disabled={chatDisabled || activeChat.loading}
                className="max-h-[140px] min-h-[52px] resize-none border-none bg-transparent px-4 py-3.5 text-sm focus-visible:ring-0"
              />
            </PromptInput>

            <div className="flex items-center gap-2 border-t border-border px-2 py-1.5">
              <Select
                value={selectedModelId}
                onValueChange={setSelectedModelId}
                disabled={!pickerModels.length}
              >
                <SelectTrigger
                  className="h-8 w-auto gap-1 border-border/60 text-xs"
                  aria-label="Model"
                >
                  <SelectValue placeholder="Model" />
                </SelectTrigger>
                <SelectContent>
                  {pickerModels.map((model) => (
                    <SelectItem key={model.id} value={model.modelId}>
                      {model.modelName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex-1" />

              {activeChat.loading ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleStop}
                  aria-label="Stop generating"
                >
                  <IconPlayerStop className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="icon"
                  onClick={submitInput}
                  disabled={!canSend}
                  aria-label="Send message"
                >
                  <IconSend className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {modelsFetched && modelLoadError && (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <IconAlertCircle className="h-3.5 w-3.5" />
              Unable to load AI models.
            </div>
          )}
          {modelsFetched && !modelLoadError && !pickerModels.length && (
            <div className="text-xs text-muted-foreground">No AI models configured.</div>
          )}
          {modelsFetched &&
            !modelLoadError &&
            studentModelPolicyActive &&
            pickerModels.length > 0 && (
              <div className="text-xs text-muted-foreground">
                Tutor model choices are limited by your course configuration.
              </div>
            )}
        </div>
      )}

      {/* Add / change provider key */}
      <Dialog open={showApiKeyDialog} onOpenChange={setShowApiKeyDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{getProviderLabel(currentProvider)} API key</DialogTitle>
            <DialogDescription>
              Stored for your account on this device and sent through EduAI services to{" "}
              {getProviderLabel(currentProvider)} when you use AI. Signing out removes it from this
              device. You can also manage keys in Settings → Providers.
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
                  <Spinner />
                  Validating…
                </>
              ) : (
                "Save"
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
  return randomId();
}
