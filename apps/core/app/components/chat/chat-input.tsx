import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from "@eduai/ui";
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
import { useMotionReducedPreference } from "~/components/assistive/ui-preferences-provider";
import { PromptInput, PromptInputTextarea } from "@eduai/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@eduai/ui";
import {
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
  chatModels: Array<{
    id: string;
    name: string;
    description: string;
    provider: string;
    maxTokens?: number;
    supportsImages?: boolean;
    supportsTools?: boolean;
  }>;
  selectedModelInfo?: {
    id: string;
    name: string;
    description: string;
    provider: string;
    maxTokens?: number;
    supportsImages?: boolean;
    supportsTools?: boolean;
  };
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

const TOOLBAR_CHIP =
  "inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-border/50 bg-background/80 px-2 text-[11px] font-medium text-foreground/80 transition-colors hover:border-border hover:bg-muted hover:text-foreground";

const TOOLBAR_CHIP_ACTIVE =
  "border-border bg-muted text-foreground";

/** Solid accent fill — accent-foreground is light, so never pair it with bg-accent/10. */
const TOOLBAR_TOGGLE_ACTIVE =
  "border-accent bg-accent text-accent-foreground shadow-sm hover:bg-accent hover:text-accent-foreground";

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
    const event = {
      target: { value },
      currentTarget: { value },
    } as React.ChangeEvent<HTMLInputElement>;
    onInputChange(event);
  };

  const handleSubmit = () => {
    const formEvent = {
      preventDefault: () => {},
      currentTarget: {} as HTMLFormElement,
    } as React.FormEvent<HTMLFormElement>;
    onSubmit(formEvent);
  };

  const selectedCourseLabel = selectedCourseId
    ? (availableCourses.find((c) => c.code === selectedCourseId)?.code ??
      selectedCourseId)
    : null;

  const canSend = !isLoading && !disabledReason && input.trim().length > 0;
  const controlsDisabled = !!disabledReason;
  const motionReduced = useMotionReducedPreference();
  const chipPress = motionReduced
    ? ""
    : "transition-[transform,background-color,border-color,box-shadow] duration-200 ease-[cubic-bezier(0.34,1.2,0.64,1)] active:scale-[0.96]";

  return (
    <>
      <div className="flex-shrink-0 border-t border-border/40 bg-background/95 backdrop-blur-sm">
        <div className="mx-auto max-w-3xl px-4 pb-4 pt-3 md:px-6">
          {disabledReason === "no-courses" && (
            <div className="mb-2.5 flex items-start gap-2 rounded-xl bg-muted/60 p-3">
              <IconBooksOff
                size={16}
                className="mt-0.5 flex-shrink-0 text-muted-foreground"
              />
              <span className="text-xs text-muted-foreground">
                Chat is disabled — you are not enrolled in any courses. Once
                you're enrolled in a course, you can start chatting.
              </span>
            </div>
          )}

          <div
            className={cn(
              "overflow-hidden rounded-2xl border border-border/60 bg-muted/10 shadow-sm transition-[box-shadow,border-color,transform] duration-300 ease-out focus-within:border-border/80 focus-within:shadow-md",
              !motionReduced && "focus-within:scale-[1.004]",
              assistiveHighlight && ASSISTIVE_INPUT_ANCHOR_CLASS,
              controlsDisabled && "pointer-events-none opacity-40",
            )}
          >
            <PromptInput
              value={input}
              onValueChange={handleValueChange}
              onSubmit={handleSubmit}
              isLoading={isLoading}
              className="cursor-text border-none bg-transparent p-0 shadow-none"
            >
              <PromptInputTextarea
                id={CHAT_MESSAGE_INPUT_ID}
                placeholder={
                  selectedCourseLabel
                    ? `Ask about ${selectedCourseLabel}…`
                    : "Ask anything…"
                }
                disabled={isLoading || !!disabledReason}
                className="max-h-[120px] min-h-[52px] resize-none border-none bg-transparent px-4 py-3.5 text-[15px] text-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-60"
              />
            </PromptInput>

            <div className="flex items-center gap-1.5 border-t border-border/40 px-2 py-1.5">
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
                {showCourseSelector && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        disabled={controlsDisabled}
                        className={cn(
                          TOOLBAR_CHIP,
                          chipPress,
                          selectedCourseId && TOOLBAR_CHIP_ACTIVE,
                        )}
                      >
                        <IconBooks size={12} stroke={2} />
                        <span className="max-w-[88px] truncate">
                          {selectedCourseLabel ?? "Course"}
                        </span>
                        <IconChevronDown size={10} stroke={2.5} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      side="top"
                      className="min-w-[220px]"
                    >
                      {availableCourses.map((course) => (
                        <DropdownMenuItem
                          key={course.code}
                          onSelect={() => setSelectedCourseId(course.code)}
                          className={
                            selectedCourseId === course.code
                              ? "bg-primary/5"
                              : ""
                          }
                        >
                          <span className="mr-1 font-semibold">
                            {course.code}
                          </span>
                          <span className="truncate text-muted-foreground">
                            — {course.name}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={controlsDisabled}
                      className={cn(TOOLBAR_CHIP, chipPress, TOOLBAR_CHIP_ACTIVE)}
                    >
                      <IconRobot size={12} stroke={2} />
                      <span className="max-w-[120px] truncate">
                        {selectedModelInfo?.name ?? "Model"}
                      </span>
                      <IconChevronDown size={10} stroke={2.5} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    side="top"
                    className="min-w-[200px]"
                  >
                    {chatModels.map((model) => (
                      <DropdownMenuItem
                        key={model.id}
                        onSelect={() => setSelectedModel(model.id)}
                        className={
                          selectedModel === model.id ? "bg-primary/5" : ""
                        }
                      >
                        <span className="font-semibold">{model.name}</span>
                        <span className="ml-1.5 text-[11px] text-muted-foreground">
                          {model.provider}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {(onAdhdAssistChange || onFocusModeChange) && (
                  <span
                    aria-hidden
                    className="mx-0.5 h-4 w-px shrink-0 bg-border/60"
                  />
                )}

                {onAdhdAssistChange && (
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          disabled={controlsDisabled}
                          aria-pressed={adhdAssist}
                          aria-label="Assistive mode"
                          onClick={() => onAdhdAssistChange(!adhdAssist)}
                          className={cn(
                            TOOLBAR_CHIP,
                            chipPress,
                            adhdAssist && TOOLBAR_TOGGLE_ACTIVE,
                          )}
                        >
                          <IconBrain size={12} stroke={2} />
                          <span className="hidden sm:inline">Assist</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[220px]">
                        <p>
                          Formats AI responses for improved focus and
                          readability.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}

                {onFocusModeChange && (
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          disabled={!adhdAssist || controlsDisabled}
                          aria-pressed={focusMode}
                          aria-label="Focus mode"
                          onClick={() => onFocusModeChange(!focusMode)}
                          className={cn(
                            TOOLBAR_CHIP,
                            chipPress,
                            focusMode && TOOLBAR_TOGGLE_ACTIVE,
                            !adhdAssist &&
                              "pointer-events-none opacity-35 grayscale",
                          )}
                        >
                          <IconFocusCentered size={12} stroke={2} />
                          <span className="hidden sm:inline">Focus</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[220px]">
                        <p>Dims everything except the current exchange.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={controlsDisabled}
                  onClick={() => setSettingsOpen(true)}
                  className={cn(
                    "h-7 w-7 rounded-lg border border-border/50 bg-background/80 p-0 text-foreground/75 hover:bg-muted hover:text-foreground",
                    chipPress,
                  )}
                  aria-label="Chat settings"
                >
                  <IconSettings size={14} stroke={2} />
                </Button>

                {isLoading && onStop ? (
                  <button
                    type="button"
                    onClick={onStop}
                    aria-label="Stop generating"
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/40 text-muted-foreground transition-colors hover:bg-muted/70",
                      chipPress,
                    )}
                  >
                    <IconPlayerStop size={15} stroke={2} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!canSend}
                    aria-label="Send message"
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-200 ease-[cubic-bezier(0.34,1.2,0.64,1)]",
                      !motionReduced && canSend && "hover:scale-105 active:scale-95",
                      canSend
                        ? "bg-primary text-primary-foreground hover:opacity-90"
                        : "border border-border/50 bg-muted text-muted-foreground",
                    )}
                  >
                    <IconSend size={15} stroke={2.5} />
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
