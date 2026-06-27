import { Button, Label, Switch, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, cn } from "@eduai/ui";
import {
  IconSettings,
  IconBooks,
  IconRobot,
  IconChevronDown,
  IconSend,
  IconPlayerStop,
  IconBrain,
  IconFocusCentered,
  IconBooksOff,
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
import {
  ASSISTIVE_FOCUS_CHROME_CLASS,
  ASSISTIVE_INPUT_ANCHOR_CLASS,
  CHAT_MESSAGE_INPUT_ID,
} from "~/components/assistive/active-highlight";

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
  adhdAssist?: boolean;
  onAdhdAssistChange?: (v: boolean) => void;
  focusMode?: boolean;
  onFocusModeChange?: (v: boolean) => void;
  assistiveHighlight?: boolean;
  systemPrompt?: string | null;
  onSystemPromptSave?: (p: string | null) => void;
  disabledReason?: string;
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
  adhdAssist = false,
  onAdhdAssistChange,
  focusMode = false,
  onFocusModeChange,
  assistiveHighlight = false,
  systemPrompt,
  onSystemPromptSave,
  disabledReason,
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

  const canSend = !isLoading && !disabledReason && input.trim().length > 0;

  return (
    <>
      <div className="flex-shrink-0 px-4 pb-6 pt-2 bg-background">
        <div className="max-w-3xl mx-auto">
          {disabledReason === "no-courses" && (
            <div className="mb-3 flex items-start gap-2 p-3 rounded-xl bg-muted/60">
              <IconBooksOff size={16} className="flex-shrink-0 mt-0.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Chat is disabled — you are not enrolled in any courses.
              </span>
            </div>
          )}

          <div
            className={cn(
              "rounded-2xl border border-border bg-muted/25 shadow-sm transition-shadow focus-within:shadow-md",
              assistiveHighlight && ASSISTIVE_INPUT_ANCHOR_CLASS,
              disabledReason && "opacity-60 pointer-events-none",
            )}
          >
            <PromptInput
              value={input}
              onValueChange={handleValueChange}
              onSubmit={handleSubmit}
              isLoading={isLoading}
              className="border-0 bg-transparent shadow-none p-0"
            >
              <PromptInputTextarea
                id={CHAT_MESSAGE_INPUT_ID}
                placeholder={selectedCourseLabel ? `Message EduAI about ${selectedCourseLabel}…` : "How can I help you today?"}
                disabled={isLoading || !!disabledReason}
                className="min-h-[52px] max-h-[200px] resize-none border-none bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-[15px] text-foreground placeholder:text-muted-foreground/70 px-4 pt-4 pb-2 disabled:opacity-60"
              />
            </PromptInput>

            <div className={cn("flex items-center gap-1.5 px-3 pb-3 flex-wrap", disabledReason && "pointer-events-none")}>
              {showCourseSelector && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={!!disabledReason}
                      className={cn(
                        "inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors",
                        ASSISTIVE_FOCUS_CHROME_CLASS,
                      )}
                    >
                      <IconBooks size={13} stroke={2} />
                      {selectedCourseLabel ?? "Course"}
                      <IconChevronDown size={10} stroke={2.5} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="top" className="min-w-[220px]">
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

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={!!disabledReason}
                    className={cn(
                      "inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors",
                      ASSISTIVE_FOCUS_CHROME_CLASS,
                    )}
                  >
                    <IconRobot size={13} stroke={2} />
                    {selectedModelInfo?.name ?? "Model"}
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

              <div className="ml-auto flex items-center gap-1">
                {onAdhdAssistChange && (
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            "flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors",
                            adhdAssist
                              ? "bg-accent/15 text-accent-foreground"
                              : "text-muted-foreground hover:bg-muted/60",
                          )}
                        >
                          <IconBrain size={14} strokeWidth={2} className="shrink-0" />
                          <Label htmlFor="adhd-assist-composer" className="cursor-pointer text-xs font-medium whitespace-nowrap">
                            Assist
                          </Label>
                          <Switch
                            id="adhd-assist-composer"
                            checked={adhdAssist}
                            disabled={!!disabledReason}
                            onCheckedChange={(checked) => onAdhdAssistChange(Boolean(checked))}
                            aria-label="Assistive mode"
                            className="shrink-0 scale-90"
                          />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[220px]">
                        <p>Formats responses for improved focus and readability.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}

                {onFocusModeChange && (
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            "flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors",
                            !adhdAssist && "opacity-40 pointer-events-none",
                            focusMode
                              ? "bg-accent/15 text-accent-foreground"
                              : "text-muted-foreground hover:bg-muted/60",
                          )}
                        >
                          <IconFocusCentered size={14} strokeWidth={2} className="shrink-0" />
                          <Label htmlFor="assistive-focus-composer" className="cursor-pointer text-xs font-medium whitespace-nowrap">
                            Focus
                          </Label>
                          <Switch
                            id="assistive-focus-composer"
                            checked={focusMode}
                            disabled={!adhdAssist || !!disabledReason}
                            onCheckedChange={(checked) => onFocusModeChange(Boolean(checked))}
                            aria-label="Focus mode"
                            className="shrink-0 scale-90"
                          />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[220px]">
                        <p>Hides sidebars and selectors; dims older messages.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!!disabledReason}
                  onClick={() => setSettingsOpen(true)}
                  className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-foreground"
                  aria-label="Chat settings"
                >
                  <IconSettings size={15} stroke={2} />
                </Button>

                {isLoading && onStop ? (
                  <button
                    type="button"
                    onClick={onStop}
                    aria-label="Stop generating"
                    className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
                  >
                    <IconPlayerStop size={16} stroke={2} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!canSend}
                    aria-label="Send message"
                    className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors disabled:opacity-40"
                    style={{
                      background: canSend ? "var(--primary)" : "var(--muted)",
                      color: canSend ? "var(--primary-foreground)" : "var(--muted-foreground)",
                    }}
                  >
                    <IconSend size={16} stroke={2.5} />
                  </button>
                )}
              </div>
            </div>
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
        systemPrompt={systemPrompt}
        onSystemPromptSave={onSystemPromptSave}
      />
    </>
  );
}
