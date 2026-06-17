import { Button } from "~/components/ui/button";
import { Settings } from "lucide-react";
import { useState } from "react";
import { ApiKeySettings } from "./api-key-settings";
import { useApiKeys } from "~/hooks/use-api-keys";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction
} from "~/components/ui/prompt-input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "~/components/ui/select";
import {
  ASSISTIVE_FOCUS_CHROME_CLASS,
  ASSISTIVE_INPUT_ANCHOR_CLASS,
  CHAT_MESSAGE_INPUT_ID,
} from "~/components/assistive/active-highlight";
import { cn } from "~/lib/utils";

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onStop?: () => void;
  selectedCourseId: string | null;
  setSelectedCourseId: (value: string | null) => void;
  availableCourses: Array<{ id: string; name: string; code: string }>;
  selectedModel: string;
  setSelectedModel: (value: string) => void;
  chatModels: Array<{ id: string; name: string; description: string; provider: string; maxTokens?: number; supportsImages?: boolean; supportsTools?: boolean }>;
  selectedModelInfo?: { id: string; name: string; description: string; provider: string; maxTokens?: number; supportsImages?: boolean; supportsTools?: boolean };
  showCourseSelector?: boolean;
  assistiveHighlight?: boolean;
}

export function ChatInput({
  input,
  isLoading,
  onInputChange,
  onSubmit,
  onStop,
  selectedCourseId,
  setSelectedCourseId,
  availableCourses,
  selectedModel,
  setSelectedModel,
  chatModels,
  selectedModelInfo,
  showCourseSelector = true,
  assistiveHighlight = false,
}: ChatInputProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const {
    apiKeys,
    isProviderConfigured,
    updateProviderSettings,
    removeProviderSettings,
  } = useApiKeys();

  const handleValueChange = (value: string) => {
    const event = {
      target: { value },
      currentTarget: { value }
    } as React.ChangeEvent<HTMLInputElement>;
    onInputChange(event);
  };

  const handleSubmit = () => {
    const formEvent = {
      preventDefault: () => {},
      currentTarget: {} as HTMLFormElement
    } as React.FormEvent<HTMLFormElement>;
    onSubmit(formEvent);
  };

  return (
    <>
      <div className="sticky bottom-0 p-4 bg-background/80 backdrop-blur-sm">
        <div className="container max-w-4xl mx-auto">
          <PromptInput
            value={input}
            onValueChange={handleValueChange}
            onSubmit={handleSubmit}
            isLoading={isLoading}
            className={cn(
              "shadow-lg border-border/50",
              assistiveHighlight && ASSISTIVE_INPUT_ANCHOR_CLASS,
            )}
          >
            <PromptInputTextarea
              id={CHAT_MESSAGE_INPUT_ID}
              placeholder="Message EduAI..."
              disabled={isLoading}
              className="min-h-[60px] max-h-[200px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-base placeholder:text-muted-foreground/60"
            />
            <div className="flex items-center gap-2 pt-2">
              <PromptInputActions>
                <PromptInputAction tooltip="API Key Settings">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSettingsOpen(true)}
                    className="h-10 w-10 rounded-full hover:bg-muted/80 transition-colors"
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                </PromptInputAction>
              </PromptInputActions>
              {showCourseSelector && (
                <div className={ASSISTIVE_FOCUS_CHROME_CLASS}>
                  <Select value={selectedCourseId || "none"} onValueChange={(value) => setSelectedCourseId(value === "none" ? null : value)}>
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                      {selectedCourseId
                        ? (availableCourses.find(c => c.code === selectedCourseId)?.code ?? "No course selected")
                        : "No course selected"}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No course selected</SelectItem>
                      {availableCourses.map((course) => (
                        <SelectItem key={course.code} value={course.code}>
                          {course.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className={ASSISTIVE_FOCUS_CHROME_CLASS}>
                <Select value={selectedModel} onValueChange={setSelectedModel}>
                  <SelectTrigger className="w-[140px] h-8 text-xs">
                    {selectedModelInfo?.name}
                  </SelectTrigger>
                  <SelectContent>
                    {chatModels.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <PromptInputActions className="ml-auto">
                {isLoading && onStop ? (
                  <PromptInputAction tooltip="Stop generating">
                    <Button
                      type="button"
                      onClick={onStop}
                      size="sm"
                      variant="outline"
                      className="h-10 w-10 rounded-full border-border/50 hover:bg-muted/80 hover:border-primary/30 transition-all duration-200"
                    >
                      <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    </Button>
                  </PromptInputAction>
                ) : (
                  <PromptInputAction tooltip="Send message">
                    <Button
                      type="button"
                      onClick={handleSubmit}
                      disabled={isLoading || !input.trim()}
                      size="sm"
                      className="h-10 w-10 rounded-full shadow-sm disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 transition-all duration-200 bg-gradient-to-r from-primary to-primary/90"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                        />
                      </svg>
                    </Button>
                  </PromptInputAction>
                )}
              </PromptInputActions>
            </div>
          </PromptInput>
        </div>
      </div>
      <ApiKeySettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        apiKeys={apiKeys}
        isProviderConfigured={isProviderConfigured}
        onUpdateProvider={updateProviderSettings}
        onRemoveProvider={removeProviderSettings}
      />
    </>
  );
}
