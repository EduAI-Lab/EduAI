import { useEffect, useMemo, useState } from "react";
import { IconCheck, IconRoute } from "@tabler/icons-react";

import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@eduai/ui";

import type { AIModel } from "~/hooks/api/types";

export type AutoRoutingSelection = {
  smallModelIds: string[];
  largeModelIds: string[];
};

type AutoRoutingConfigDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: AIModel[];
  loading?: boolean;
  error?: string | null;
  onSave: (selection: AutoRoutingSelection) => Promise<void>;
};

type RoutingRole = "small" | "large";

function modelIsInRole(model: AIModel, role: RoutingRole): boolean {
  if (role === "small") return model.routerTier === "TIER_1";
  return model.routerTier === "TIER_2" || model.routerTier === "TIER_3";
}

export function AutoRoutingConfigDialog({
  open,
  onOpenChange,
  models,
  loading = false,
  error = null,
  onSave,
}: AutoRoutingConfigDialogProps) {
  const [smallModelIds, setSmallModelIds] = useState<string[]>([]);
  const [largeModelIds, setLargeModelIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const chatModels = useMemo(
    () =>
      models
        .filter((model) => model.type === "CHAT")
        .sort((left, right) => left.name.localeCompare(right.name)),
    [models],
  );

  useEffect(() => {
    if (!open) return;
    setSmallModelIds(chatModels.filter((model) => modelIsInRole(model, "small")).map((m) => m.id));
    setLargeModelIds(chatModels.filter((model) => modelIsInRole(model, "large")).map((m) => m.id));
    setSaveError(null);
  }, [chatModels, open]);

  const toggleModel = (modelId: string, role: RoutingRole, checked: boolean) => {
    if (role === "small") {
      setSmallModelIds((current) =>
        checked ? [...current, modelId] : current.filter((id) => id !== modelId),
      );
      if (checked) setLargeModelIds((current) => current.filter((id) => id !== modelId));
      return;
    }

    setLargeModelIds((current) =>
      checked ? [...current, modelId] : current.filter((id) => id !== modelId),
    );
    if (checked) setSmallModelIds((current) => current.filter((id) => id !== modelId));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ smallModelIds, largeModelIds });
      onOpenChange(false);
    } catch (saveErr) {
      setSaveError(saveErr instanceof Error ? saveErr.message : "Failed to save Auto models");
    } finally {
      setSaving(false);
    }
  };

  const renderModelList = (role: RoutingRole) => {
    const selectedIds = role === "small" ? smallModelIds : largeModelIds;
    return (
      <div className="space-y-2">
        {chatModels.length === 0 && (
          <p className="text-sm text-muted-foreground">No chat models are available.</p>
        )}
        {chatModels.map((model) => {
          const checked = selectedIds.includes(model.id);
          return (
            <label
              key={model.id}
              className="flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={(value) => toggleModel(model.id, role, value === true)}
                aria-label={`${model.name} for ${role} tier`}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{model.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {model.provider.displayName} · {model.modelId}
                </span>
              </span>
              {checked && <IconCheck className="mt-0.5 h-4 w-4 text-primary" aria-hidden="true" />}
            </label>
          );
        })}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconRoute className="h-5 w-5" />
            Configure Auto models
          </DialogTitle>
          <DialogDescription>
            Choose the active chat models that Auto can use. Auto evaluates each request and sends
            straightforward work to the Small tier, while more demanding work goes to the Large
            tier.
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
          <div className="grid gap-4 md:grid-cols-2">
            <section className="space-y-3 rounded-lg border p-4" aria-labelledby="small-tier-title">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 id="small-tier-title" className="font-semibold">
                    Small tier
                  </h3>
                  <Badge variant="secondary">{smallModelIds.length} selected</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Faster and more efficient for short, straightforward questions and routine course
                  work.
                </p>
              </div>
              {renderModelList("small")}
            </section>

            <section className="space-y-3 rounded-lg border p-4" aria-labelledby="large-tier-title">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 id="large-tier-title" className="font-semibold">
                    Large tier
                  </h3>
                  <Badge variant="secondary">{largeModelIds.length} selected</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  More capable for complex reasoning, coding, long context, and difficult course
                  questions.
                </p>
              </div>
              {renderModelList("large")}
            </section>
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
            {saving ? "Saving…" : "Save Auto models"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
