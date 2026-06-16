import { SystemPromptSettings } from "~/components/chat/system-prompt-settings";

export interface ChatHeaderControlsProps {
  systemPrompt: string | null;
  onSystemPromptSave: (prompt: string | null) => void;
}

export function ChatHeaderControls({
  systemPrompt,
  onSystemPromptSave,
}: ChatHeaderControlsProps) {
  return (
    <div className="flex h-full items-center gap-3 sm:gap-4">
      <SystemPromptSettings
        systemPrompt={systemPrompt}
        onSave={onSystemPromptSave}
      />
    </div>
  );
}
