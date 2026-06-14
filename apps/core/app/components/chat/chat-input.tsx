import { Button } from "@eduai/ui";
import {
  IconSettings,
  IconBooks,
  IconRobot,
  IconChevronDown,
  IconSend,
  IconPlayerStop,
} from "@tabler/icons-react";
import { useState } from "react";
import { ApiKeySettings } from "./api-key-settings";
import { useApiKeys } from "~/hooks/use-api-keys";
import {
  PromptInput,
  PromptInputTextarea,
} from "@eduai/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@eduai/ui";

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
}: ChatInputProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const {
    apiKeys,
    isProviderConfigured,
    updateProviderSettings,
    removeProviderSettings,
  } = useApiKeys();

  const handleValueChange = (value: string) => {
    // Create a synthetic event to maintain compatibility
    const event = {
      target: { value },
      currentTarget: { value }
    } as React.ChangeEvent<HTMLInputElement>;
    onInputChange(event);
  };

  const handleSubmit = () => {
    // Create a synthetic form event
    const formEvent = {
      preventDefault: () => {},
      currentTarget: {} as HTMLFormElement
    } as React.FormEvent<HTMLFormElement>;
    onSubmit(formEvent);
  };

  const selectedCourseLabel = selectedCourseId
    ? (availableCourses.find(c => c.code === selectedCourseId)?.code ?? selectedCourseId)
    : null;

  const canSend = !isLoading && input.trim().length > 0;

  return (
    <>
      {/* Bottom composer bar */}
      <div className="border-t border-border bg-background flex-shrink-0">
        <div className="max-w-[720px] mx-auto px-6 pt-3 pb-4">

          {/* Selector pills row */}
          <div className="flex items-center gap-2 mb-2.5">
            {/* Course selector pill */}
            {showCourseSelector && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border border-border transition-all duration-150 cursor-pointer min-h-[28px]"
                    style={{
                      background: selectedCourseId ? "var(--primary)" : "var(--muted)",
                      color: selectedCourseId ? "var(--primary-foreground)" : "var(--muted-foreground)",
                    }}
                  >
                    <IconBooks size={12} stroke={2} />
                    {selectedCourseLabel ?? "Select course"}
                    <IconChevronDown size={10} stroke={2.5} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="min-w-[220px]">
                  <DropdownMenuItem
                    onSelect={() => setSelectedCourseId(null)}
                    className={!selectedCourseId ? "bg-primary/5 font-medium" : ""}
                  >
                    No course (general)
                  </DropdownMenuItem>
                  {availableCourses.map((course) => (
                    <DropdownMenuItem
                      key={course.code}
                      onSelect={() => setSelectedCourseId(course.code)}
                      className={selectedCourseId === course.code ? "bg-primary/5" : ""}
                    >
                      <span className="font-semibold mr-1">{course.code}</span>
                      <span className="text-muted-foreground truncate">— {course.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Model selector pill */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border border-border bg-muted text-muted-foreground transition-all duration-150 cursor-pointer min-h-[28px] hover:text-foreground"
                >
                  <IconRobot size={12} stroke={2} />
                  {selectedModelInfo?.name ?? "Select model"}
                  <IconChevronDown size={10} stroke={2.5} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="min-w-[200px]">
                {chatModels.map((model) => (
                  <DropdownMenuItem
                    key={model.id}
                    onSelect={() => setSelectedModel(model.id)}
                    className={selectedModel === model.id ? "bg-primary/5" : ""}
                  >
                    <span className="font-semibold">{model.name}</span>
                    <span className="text-muted-foreground text-[11px] ml-1.5">{model.provider}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* API key settings — right side */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSettingsOpen(true)}
              className="ml-auto h-7 w-7 p-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="API key settings"
            >
              <IconSettings size={14} stroke={2} />
            </Button>
          </div>

          {/* Textarea + send row */}
          <div className="flex items-end gap-2.5">
            <PromptInput
              value={input}
              onValueChange={handleValueChange}
              onSubmit={handleSubmit}
              isLoading={isLoading}
              className="flex-1 border border-border rounded-[var(--radius-xl)] bg-background shadow-none p-0 cursor-text"
            >
              <PromptInputTextarea
                placeholder={selectedCourseLabel ? `Ask about ${selectedCourseLabel} materials…` : "Ask anything…"}
                disabled={isLoading}
                className="min-h-[44px] max-h-[120px] resize-none border-none bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm placeholder:text-muted-foreground/60 px-3.5 py-2.5"
              />
            </PromptInput>

            {/* Send / stop button — 44×44 min touch target */}
            {isLoading && onStop ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop generating"
                className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-[var(--radius-xl)] border border-border bg-muted text-muted-foreground hover:bg-muted/80 hover:border-primary/30 transition-all duration-150 cursor-pointer"
              >
                <IconPlayerStop size={17} stroke={2} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSend}
                aria-label="Send message"
                className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-[var(--radius-xl)] transition-all duration-150 cursor-pointer disabled:cursor-not-allowed"
                style={{
                  background: canSend ? "var(--primary)" : "var(--muted)",
                  color: canSend ? "var(--primary-foreground)" : "var(--muted-foreground)",
                }}
              >
                <IconSend size={17} stroke={2.5} />
              </button>
            )}
          </div>

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
