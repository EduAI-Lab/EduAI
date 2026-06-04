import { useState, useEffect } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";
import { Label } from "~/components/ui/label";
import { MessageSquare } from "lucide-react";

export interface SystemPromptSettingsProps {
  systemPrompt?: string | null;
  onSave: (systemPrompt: string | null) => void;
  compact?: boolean;
}

export function SystemPromptSettings({ systemPrompt, onSave, compact = false }: SystemPromptSettingsProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(systemPrompt || "");

  useEffect(() => {
    setPrompt(systemPrompt || "");
  }, [systemPrompt]);

  const handleSave = () => {
    onSave(prompt.trim() || null);
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
          className={compact ? "h-8 gap-1.5 px-2.5 text-xs" : "h-9 gap-2"}
        >
          <MessageSquare className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
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
              className="min-h-[200px] font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              The system prompt guides the AI's behavior and responses. Leave empty to use the default prompt.
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

