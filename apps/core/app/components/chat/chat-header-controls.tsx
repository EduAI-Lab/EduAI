import { SystemPromptSettings } from "~/components/chat/system-prompt-settings";
import { Switch } from "~/components/ui/switch";
import { Label } from "~/components/ui/label";

export interface ChatHeaderControlsProps {
  adhdAssist: boolean;
  onAdhdAssistChange: (checked: boolean) => void;
  systemPrompt: string | null;
  onSystemPromptSave: (prompt: string | null) => void;
}

export function ChatHeaderControls({
  adhdAssist,
  onAdhdAssistChange,
  systemPrompt,
  onSystemPromptSave,
}: ChatHeaderControlsProps) {
  return (
    <div className="flex h-full items-center gap-3 sm:gap-4">
      <div className="flex h-9 items-center gap-2">
        <Switch
          id="adhd-assist"
          checked={adhdAssist}
          onCheckedChange={(checked) => onAdhdAssistChange(Boolean(checked))}
          aria-label="Assistive mode"
        />
        <Label htmlFor="adhd-assist" className="text-sm whitespace-nowrap">
          Assistive mode {adhdAssist ? "On" : "Off"}
        </Label>
      </div>
      <SystemPromptSettings
        systemPrompt={systemPrompt}
        onSave={onSystemPromptSave}
      />
    </div>
  );
}
