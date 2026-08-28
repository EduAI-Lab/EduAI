import { useEffect, useMemo, useState } from "react";
import { IconBrain } from "@tabler/icons-react";

import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@eduai/ui";
import type { AIModel } from "~/hooks/api/types";

const FALLBACK_VALUE = "__selected_chat_model__";

type AssistModelConfigDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: AIModel[];
  selectedModelId: string | null;
  loading?: boolean;
  error?: string | null;
  onSave: (modelId: string | null) => Promise<void>;
};

function registryId(model: AIModel): string {
  return `${model.provider.name}:${model.modelId}`;
}

export function AssistModelConfigDialog({
  open,
  onOpenChange,
  models,
  selectedModelId,
  loading = false,
  error = null,
  onSave,
}: AssistModelConfigDialogProps) {
  const [draftModelId, setDraftModelId] = useState(selectedModelId ?? FALLBACK_VALUE);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const chatModels = useMemo(
    () =>
      models
        .filter((model) => model.type === "CHAT" && model.isActive && model.provider.isActive)
        .toSorted((left, right) => left.name.localeCompare(right.name)),
    [models],
  );

  useEffect(() => {
    if (open) {
      setDraftModelId(selectedModelId ?? FALLBACK_VALUE);
      setSaveError(null);
    }
  }, [open, selectedModelId]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(draftModelId === FALLBACK_VALUE ? null : draftModelId);
      onOpenChange(false);
    } catch (saveErr) {
      setSaveError(saveErr instanceof Error ? saveErr.message : "Failed to save Assist model");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconBrain className="h-5 w-5" />
            Configure AI Assist model
          </DialogTitle>
          <DialogDescription>
            Choose the concrete chat model used when Assistive mode is enabled, including when an
            existing answer is regenerated. If no model is selected, Assist uses the model chosen in
            the chat composer.
          </DialogDescription>
        </DialogHeader>

        {(error || saveError) && (
          <Alert variant="destructive">
            <AlertDescription>{error ?? saveError}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading chat models…</p>
        ) : (
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="assist-model-select">
              Assist model
            </label>
            <Select value={draftModelId} onValueChange={setDraftModelId}>
              <SelectTrigger id="assist-model-select">
                <SelectValue placeholder="Use selected chat model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FALLBACK_VALUE}>Use selected chat model</SelectItem>
                {chatModels.map((model) => (
                  <SelectItem key={registryId(model)} value={registryId(model)}>
                    {model.name} ({model.provider.displayName})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {chatModels.length === 0 && (
              <p className="text-sm text-muted-foreground">No active chat models are available.</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={loading || saving}>
            {saving ? "Saving…" : "Save Assist model"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
