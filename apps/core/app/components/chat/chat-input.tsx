import { Button, Label, Switch, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, cn } from "@eduai/ui";
import {
  IconSettings,
  IconBooks,
  IconRobot,
  IconChevronDown,
  IconSend,
  IconPlayerStop,
  IconBrain,
  IconBan,
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
      {/* Bottom composer bar */}
      <div className="border-t border-border bg-background flex-shrink-0">
        <div className="max-w-[720px] mx-auto px-6 pt-3 pb-4">

          {/* Selector pills row */}
          <div className={cn("flex items-center gap-2 mb-2.5", disabledReason && "pointer-events-none opacity-40")}>
            {/* Course selector pill */}
            {showCourseSelector && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={!!disabledReason}
                    className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border border-border transition-all duration-150 cursor-pointer min-h-[28px]", ASSISTIVE_FOCUS_CHROME_CLASS)}
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
                  disabled={!!disabledReason}
                  className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border border-border bg-muted text-muted-foreground transition-all duration-150 cursor-pointer min-h-[28px] hover:text-foreground", ASSISTIVE_FOCUS_CHROME_CLASS)}
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

            {/* Right-side controls */}
            <div className="ml-auto flex items-center gap-1">
              {/* Assistive mode toggle — in right cluster, more prominent */}
              {onAdhdAssistChange && (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {/* Fixed-width pill: same elements in both states so toggling
                          never shifts the layout. Active uses the theme-safe accent
                          (legible on both light and dark) for an unmistakable state. */}
                      <div
                        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 transition-colors ${
                          adhdAssist
                            ? "border-accent bg-accent text-accent-foreground"
                            : "border-border bg-transparent text-muted-foreground"
                        }`}
                      >
                        <IconBrain size={14} strokeWidth={2} className="shrink-0" />
                        <Label
                          htmlFor="adhd-assist-composer"
                          className="cursor-pointer text-xs font-medium whitespace-nowrap text-current"
                        >
                          Assistive mode
                        </Label>
                        <Switch
                          id="adhd-assist-composer"
                          checked={adhdAssist}
                          disabled={!!disabledReason}
                          onCheckedChange={(checked) => onAdhdAssistChange(Boolean(checked))}
                          aria-label="Assistive mode"
                          className="shrink-0"
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[220px]">
                      <p>Formats AI responses for improved focus and readability.</p>
                      <p className="mt-0.5 opacity-75">Useful for ADHD and assistive reading needs.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              {onFocusModeChange && (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 transition-colors ${
                          focusMode
                            ? "border-accent bg-accent text-accent-foreground"
                            : adhdAssist
                              ? "border-border bg-transparent text-muted-foreground"
                              : "border-border bg-transparent text-muted-foreground opacity-40 grayscale pointer-events-none"
                        }`}
                      >
                        {adhdAssist ? (
                          <IconFocusCentered size={14} strokeWidth={2} className="shrink-0" />
                        ) : (
                          <IconBan size={14} strokeWidth={2} className="shrink-0" />
                        )}
                        <Label
                          htmlFor="assistive-focus-composer"
                          className="cursor-pointer text-xs font-medium whitespace-nowrap text-current"
                        >
                          Focus mode
                        </Label>
                        <Switch
                          id="assistive-focus-composer"
                          checked={focusMode}
                          disabled={!adhdAssist || !!disabledReason}
                          onCheckedChange={(checked) => onFocusModeChange(Boolean(checked))}
                          aria-label="Focus mode"
                          className={adhdAssist ? "shrink-0 cursor-pointer" : "shrink-0 cursor-pointer disabled:opacity-70"}
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[220px]">
                      <p>Dims everything except the current exchange.</p>
                      <p className="mt-0.5 opacity-75">Reduces on-screen distractions while you read and reply.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              {/* Chat settings gear button */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!!disabledReason}
                onClick={() => setSettingsOpen(true)}
                className="h-7 w-7 p-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:pointer-events-none"
                aria-label="Chat settings"
              >
                <IconSettings size={14} stroke={2} />
              </Button>
            </div>
          </div>

          {/* Disabled reason notice (if present) */}
          {disabledReason === 'no-courses' && (
            <div className="mb-2.5 flex items-start gap-2 p-3 rounded-[var(--radius-lg)] bg-muted">
              <IconBooksOff size={16} className="flex-shrink-0 mt-0.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Chat is disabled — you are not enrolled in any courses. Once you're enrolled in a course, you can start chatting.
              </span>
            </div>
          )}

          {/* Textarea + send row */}
          <div className="flex items-end gap-2.5">
            <PromptInput
              value={input}
              onValueChange={handleValueChange}
              onSubmit={handleSubmit}
              isLoading={isLoading}
              className={cn(
                "flex-1 border border-border rounded-[var(--radius-xl)] bg-background shadow-none p-0 cursor-text",
                assistiveHighlight && ASSISTIVE_INPUT_ANCHOR_CLASS,
              )}
            >
              <PromptInputTextarea
                id={CHAT_MESSAGE_INPUT_ID}
                placeholder={selectedCourseLabel ? `Ask about ${selectedCourseLabel} materials…` : "Ask anything…"}
                disabled={isLoading || !!disabledReason}
                className="min-h-[44px] max-h-[120px] resize-none border-none bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm text-foreground placeholder:text-muted-foreground/60 px-3.5 py-2.5 disabled:opacity-60"
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
        systemPrompt={systemPrompt}
        onSystemPromptSave={onSystemPromptSave}
      />
    </>
  );
}
