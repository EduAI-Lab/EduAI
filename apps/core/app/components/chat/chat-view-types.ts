import type { Message } from "ai";

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
};

export type ChatViewSharedProps = {
  chatModels: ChatModelOption[];
  selectedModel: string;
  setSelectedModel: (value: string) => void;
  selectedModelInfo?: ChatModelOption;
  selectedCourseCode: string | null;
  setSelectedCourseCode: (value: string | null) => void;
  availableCourses: ChatCourseOption[];
  messages: Message[];
  input: string;
  isLoading: boolean;
  adhdAssist: boolean;
  assistive: boolean;
  onAssistiveChange: (value: boolean) => void;
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
