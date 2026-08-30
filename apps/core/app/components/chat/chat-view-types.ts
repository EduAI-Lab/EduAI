export type ChatModelOption = {
  id: string;
  name: string;
  description: string;
  provider: string;
  maxTokens?: number;
  supportsImages?: boolean;
  supportsTools?: boolean;
};

export type ChatCourseOption = {
  id: string;
  name: string;
  code: string;
  /**
   * Optional disambiguation label shown instead of the bare code when a
   * caller's course list contains more than one offering sharing the same
   * `code` (Course.code is not globally unique — only (code, startDate,
   * section) is — #1659 review). Falls back to `code` when absent.
   */
  label?: string;
};

/** Minimal message shape for live chat + in-flight tool/progress detection. */
export type ChatViewMessage = {
  id: string;
  role: string;
  content: string | { text?: string } | Array<{ type?: string; text?: string }>;
  parts?: Array<{
    type?: string;
    text?: string;
    toolInvocation?: {
      toolName?: string;
      state?: string;
      toolCallId?: string;
      args?: unknown;
    };
    toolName?: string;
    state?: string;
  } | null>;
};

export type ChatViewSharedProps = {
  chatModels: ChatModelOption[];
  selectedModel: string;
  setSelectedModel: (value: string) => void;
  selectedModelInfo?: ChatModelOption;
  selectedCourseCode: string | null;
  setSelectedCourseCode: (value: string | null) => void;
  availableCourses: ChatCourseOption[];
  /**
   * Which field of `ChatCourseOption` the selector keys/emits through
   * `selectedCourseCode`/`setSelectedCourseCode` — "code" (default) or "id".
   * See `ChatCourseOption.label` / chat-input.tsx's `courseSelectionKey`.
   */
  courseSelectionKey?: "code" | "id";
  messages: ChatViewMessage[];
  input: string;
  isLoading: boolean;
  adhdAssist: boolean;
  assistive: boolean;
  onAssistiveChange: (value: boolean) => void;
  /** True while the latest response is being re-generated for the toggled Assist mode (#1246). */
  assistBusy?: boolean;
  focusMode: boolean;
  onFocusModeChange: (value: boolean) => void;
  systemPrompt: string | null;
  onSystemPromptSave: (prompt: string | null) => Promise<void>;
  webToolsEnabled: boolean;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onStop?: () => void;
  onSelectPrompt: (prompt: string) => void;
  isStudentWithCourseChat?: boolean;
  disabledReason?: string;
  cappedMessageIds?: Set<string>;
  onContinue?: (messageId: string) => void;

  /** Registry ids from X-Routed-Model, keyed by assistant message id. */
  routedModelByMessageId?: Record<string, string>;
  /** In-flight assistant bubble before onFinish assigns message id. */
  streamingRoutedRegistryId?: string | null;
  /**
   * Whether the model selector was set to an auto mode ("auto"/"auto-llm")
   * at the time each assistant message was requested, keyed by message id.
   * Read this instead of the live `selectedModel` so switching the selector
   * mid-conversation doesn't retroactively change older messages' labels.
   */
  wasAutoRoutedByMessageId?: Record<string, boolean>;
  /** Whether the in-flight request was made with an auto mode selected. */
  streamingWasAutoRouted?: boolean;
};
