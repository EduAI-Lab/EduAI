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
  messages: Array<{ id: string; role: string; content: string }>;
  input: string;
  isLoading: boolean;
  adhdAssist: boolean;
  onAssistChange: (value: boolean) => void;
  systemPrompt: string | null;
  onSystemPromptSave: (prompt: string | null) => Promise<void>;
  webToolsEnabled: boolean;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onStop?: () => void;
  onSelectPrompt: (prompt: string) => void;
  isStudentWithCourseChat?: boolean;
  disabledReason?: string;
  /** Registry ids from X-Routed-Model, keyed by assistant message id. */
  routedModelByMessageId?: Record<string, string>;
  /** In-flight assistant bubble before onFinish assigns message id. */
  streamingRoutedRegistryId?: string | null;
};
