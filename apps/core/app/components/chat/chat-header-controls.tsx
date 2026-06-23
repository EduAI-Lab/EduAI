import { IconBan, IconBrain } from "@tabler/icons-react";
import { Label, Switch, Tooltip, TooltipContent, TooltipTrigger } from "@eduai/ui";
import { SystemPromptSettings } from "~/components/chat/system-prompt-settings";

export interface ChatHeaderControlsProps {
  adhdAssist: boolean;
  onAdhdAssistChange: (checked: boolean) => void;
  focusMode: boolean;
  onFocusModeChange: (checked: boolean) => void;
  systemPrompt: string | null;
  onSystemPromptSave: (prompt: string | null) => void;
}

/**
 * AssistiveModeToggle — persistent switch + label with an "On" badge overlay.
 * The control never morphs: Switch + Label are always rendered.
 * When active, an additional navy pill badge appears to make the state unmistakable.
 * Also wraps SystemPromptSettings gear.
 */
export function ChatHeaderControls({
  adhdAssist,
  onAdhdAssistChange,
  focusMode,
  onFocusModeChange,
  systemPrompt,
  onSystemPromptSave,
}: ChatHeaderControlsProps) {
  return (
    <div className="flex h-full items-center gap-3 sm:gap-4">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2">
            <Switch
              id="adhd-assist-header"
              checked={adhdAssist}
              onCheckedChange={(checked) => onAdhdAssistChange(Boolean(checked))}
              aria-label="Assistive mode"
            />
            <Label
              htmlFor="adhd-assist-header"
              className="cursor-pointer text-sm text-muted-foreground whitespace-nowrap"
            >
              Assistive mode
            </Label>
            {adhdAssist && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground select-none">
                <IconBrain className="h-3 w-3 shrink-0" strokeWidth={2} />
                On
              </span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Formats AI responses for improved focus and readability.</p>
          <p className="mt-0.5 opacity-75">Useful for ADHD and assistive reading needs.</p>
        </TooltipContent>
      </Tooltip>
      <div
        className={
          adhdAssist
            ? "flex items-center gap-2"
            : "flex items-center gap-2 opacity-40 grayscale pointer-events-none"
        }
      >
        <Switch
          id="assistive-focus-mode"
          checked={focusMode}
          disabled={!adhdAssist}
          onCheckedChange={(checked) => onFocusModeChange(Boolean(checked))}
          aria-label="Focus mode"
          className={adhdAssist ? "cursor-pointer" : "cursor-pointer disabled:opacity-60"}
        />
        {!adhdAssist && <IconBan data-testid="focus-mode-disabled-icon" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <Label
          htmlFor="assistive-focus-mode"
          className="cursor-pointer text-sm text-muted-foreground whitespace-nowrap"
        >
          Focus mode {focusMode ? "On" : "Off"}
        </Label>
      </div>
      <SystemPromptSettings
        systemPrompt={systemPrompt}
        onSave={onSystemPromptSave}
      />
    </div>
  );
}
