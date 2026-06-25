import { useState, useEffect } from "react";
import { Button } from "@eduai/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@eduai/ui";
import { Textarea } from "@eduai/ui";
import { Label } from "@eduai/ui";
import { IconMessage } from "@tabler/icons-react";
import { SYSTEM_PROMPT_MAX_CHARS_DEFAULT } from "~/lib/ai/prompt-safety";

export interface SystemPromptSettingsProps {
  systemPrompt?: string | null;
  onSave: (systemPrompt: string | null) => void;
}

export function SystemPromptSettings({ systemPrompt, onSave }: SystemPromptSettingsProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(systemPrompt || "");

  useEffect(() => {
    setPrompt(systemPrompt || "");
  }, [systemPrompt]);

  const handleSave = () => {
    const trimmed = prompt.trim();
    const capped =
      trimmed.length > SYSTEM_PROMPT_MAX_CHARS_DEFAULT
        ? trimmed.slice(0, SYSTEM_PROMPT_MAX_CHARS_DEFAULT)
        : trimmed;
    onSave(capped || null);
    setOpen(false);
  };

  const handleClear = () => {
    setPrompt("");
    onSave(null);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-9 gap-2"
        >
          <IconMessage className="h-4 w-4" />
          <span>System Prompt</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>System Prompt Settings</DialogTitle>
          <DialogDescription>
            Set a custom system prompt for this chat. This will override the default prompt and apply to all messages in this conversation.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="system-prompt">System Prompt</Label>
            <Textarea
              id="system-prompt"
              placeholder="Enter a custom system prompt (leave empty to use default)..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={SYSTEM_PROMPT_MAX_CHARS_DEFAULT}
              className="min-h-[200px] font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              The system prompt guides the AI&apos;s behavior and responses. Leave empty to use the
              default prompt. Max {SYSTEM_PROMPT_MAX_CHARS_DEFAULT.toLocaleString()} characters (
              {prompt.length.toLocaleString()} used).
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClear} disabled={!prompt.trim()}>
            Clear
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

