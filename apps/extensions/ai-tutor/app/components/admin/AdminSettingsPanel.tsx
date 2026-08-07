import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@eduai/ui';
import { toast } from 'sonner';

import api from '~/lib/api';
import type { EduAiApiKeyStatus } from '~/lib/types';
import {
  DEFAULT_POLICY,
  buildFallbackSummary,
  clampIterations,
  formatApiKeyUpdatedTime,
  formatCostTier,
  getAdminSettingsApi,
  inferProvider,
  normalizePolicy,
  type AdminAiModelOption,
  type AdminAiModelPolicy,
  type AdminSettingsLoaderData,
  type CostTier,
} from '~/lib/admin-settings';

// `costTierClassName` (shared with admin-settings) still returns a legacy
// `.tag` className; here we only borrow the label text via `formatCostTier`
// and pick a DS Badge variant locally, mirroring `sourceTagBadgeVariant` in
// admin.tsx / settings-view.tsx.
function costTierBadgeVariant(
  costTier: CostTier | null | undefined,
): 'default' | 'secondary' | 'outline' {
  if (costTier === 'LOW') return 'secondary';
  if (costTier === 'HIGH') return 'default';
  return 'outline';
}

type AdminSettingsPanelProps = {
  loaderData: AdminSettingsLoaderData;
};

export function AdminSettingsPanel({ loaderData }: AdminSettingsPanelProps) {
  const settingsApi = getAdminSettingsApi();
  const [status, setStatus] = useState<EduAiApiKeyStatus>(loaderData.status);
  const [aiPolicy, setAiPolicy] = useState<AdminAiModelPolicy>(
    normalizePolicy(loaderData.aiPolicy ?? DEFAULT_POLICY, loaderData.aiModels),
  );
  const [initialAiPolicy, setInitialAiPolicy] = useState<AdminAiModelPolicy>(
    normalizePolicy(loaderData.aiPolicy ?? DEFAULT_POLICY, loaderData.aiModels),
  );
  const [aiModels] = useState<AdminAiModelOption[]>(loaderData.aiModels);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [savingAiPolicy, setSavingAiPolicy] = useState(false);
  const updatedLabel = useMemo(() => formatApiKeyUpdatedTime(status.updatedAt), [status.updatedAt]);

  useEffect(() => {
    if (loaderData.aiPolicyError) {
      toast.error(loaderData.aiPolicyError);
    }
  }, [loaderData.aiPolicyError]);
  const aiPolicyAvailable = loaderData.aiPolicyAvailable;
  const hasAllowedTutorModels = aiPolicy.allowedTutorModelIds.length > 0;
  const aiPolicyDirty = useMemo(() => {
    return JSON.stringify(initialAiPolicy) !== JSON.stringify(aiPolicy);
  }, [aiPolicy, initialAiPolicy]);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.setEduAiApiKey(apiKey);
      setStatus(next);
      setApiKey('');
      toast.success('Saved. This key will be used instead of the default one.');
    } catch {
      toast.error('Could not save key. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setClearing(true);
    try {
      const next = await api.clearEduAiApiKey();
      setStatus(next);
      toast.success('Cleared. The default key will be used instead.');
    } catch {
      toast.error('Could not clear the key. Please try again.');
    } finally {
      setClearing(false);
    }
  };

  const toggleTutorModel = (modelId: string) => {
    setAiPolicy((current) => {
      const nextAllowed = current.allowedTutorModelIds.includes(modelId)
        ? current.allowedTutorModelIds.filter((id) => id !== modelId)
        : [...current.allowedTutorModelIds, modelId];

      const fallbackTutor =
        current.defaultTutorModelId && nextAllowed.includes(current.defaultTutorModelId)
          ? current.defaultTutorModelId
          : (nextAllowed[0] ?? null);

      return {
        ...current,
        allowedTutorModelIds: nextAllowed,
        defaultTutorModelId: fallbackTutor,
      };
    });
  };

  const saveAiPolicy = async () => {
    if (!aiPolicyAvailable || typeof settingsApi.setAdminAiModelPolicy !== 'function') {
      toast.error('AI model settings cannot be saved right now. Please try again later.');
      return;
    }

    setSavingAiPolicy(true);
    try {
      const saved = await settingsApi.setAdminAiModelPolicy(aiPolicy);
      const normalized = normalizePolicy(saved, aiModels);
      setAiPolicy(normalized);
      setInitialAiPolicy(normalized);
      toast.success('AI loop settings saved.');
    } catch {
      toast.error('Could not save AI loop settings. Please try again.');
    } finally {
      setSavingAiPolicy(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-6 animate-fade-up delay-150">
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-foreground">AI loop policy</h2>
              <InfoBadge copy="A loop is the handoff between the student-facing tutor and the internal supervisor that checks each draft before it is shown." />
            </div>
            <p className="text-sm text-muted-foreground max-w-3xl">
              Configure the safe defaults for how student help responses are generated. Students can
              still bring their own provider keys, but they will only be able to choose tutor models
              from the allowlist you approve here. The supervisor remains fully admin-controlled.
            </p>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <div className="rounded-2xl border border-border/70 bg-card/80 p-5 space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground">Tutor</h3>
                <InfoBadge copy="The tutor is the student-facing assistant. It should be fast, clear, and Socratic rather than answer-revealing." />
              </div>
              <p className="text-sm text-muted-foreground">
                Students may override this model, but only within the tutor allowlist below.
              </p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-card/80 p-5 space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground">Supervisor</h3>
                <InfoBadge copy="The supervisor is an internal reviewer. It sees hidden answer-aware context, rejects risky drafts, and proposes revisions or a safe fallback." />
              </div>
              <p className="text-sm text-muted-foreground">
                Keep this stable and safety-oriented. Students cannot change it.
              </p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-card/80 p-5 space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground">Cost guidance</h3>
                <InfoBadge copy="Costs are qualitative here on purpose. Use these labels to weigh speed and quality without depending on fragile exact vendor pricing." />
              </div>
              <p className="text-sm text-muted-foreground">
                Low-cost models are best for routine hints. Higher-cost models are better when you
                want more careful supervision or stronger reasoning.
              </p>
            </div>
          </div>

          {!aiPolicyAvailable ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
              AI model policy settings cannot be saved yet. This feature is coming soon.
            </div>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
            <div className="space-y-4 rounded-2xl border border-border/70 bg-card/80 p-5">
              <div className="space-y-1">
                <h3 className="font-semibold text-foreground">Allowed tutor models</h3>
                <p className="text-sm text-muted-foreground">
                  Students can only choose from the models you allow here.
                </p>
              </div>

              {aiModels.length === 0 ? (
                <div className="rounded-xl border border-border px-4 py-6 text-sm text-muted-foreground">
                  No AI models are available yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {aiModels.map((model) => {
                    const isAllowed = aiPolicy.allowedTutorModelIds.includes(model.modelId);
                    const isTutorDefault = aiPolicy.defaultTutorModelId === model.modelId;
                    const isSupervisorDefault = aiPolicy.defaultSupervisorModelId === model.modelId;

                    return (
                      <label
                        key={model.id}
                        className={`flex flex-col gap-3 rounded-2xl border px-4 py-4 transition-colors sm:flex-row sm:items-start sm:justify-between ${
                          isAllowed
                            ? 'border-primary/40 bg-primary/5'
                            : 'border-border/70 bg-background/60 hover:border-primary/20'
                        }`}
                      >
                        <div className="flex gap-3">
                          <input
                            type="checkbox"
                            checked={isAllowed}
                            onChange={() => toggleTutorModel(model.modelId)}
                            className="mt-1 h-4 w-4 rounded border-border text-primary-text focus:ring-primary"
                          />
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-foreground">{model.modelName}</span>
                              <Badge variant="outline">
                                {model.provider ?? inferProvider(model.modelId)}
                              </Badge>
                              <Badge variant={costTierBadgeVariant(model.costTier)}>
                                {formatCostTier(model.costTier)}
                              </Badge>
                              {isTutorDefault ? <Badge variant="default">Tutor default</Badge> : null}
                              {isSupervisorDefault ? (
                                <Badge variant="secondary">Supervisor default</Badge>
                              ) : null}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {model.summary ?? buildFallbackSummary(model)}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono">{model.modelId}</p>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-4 rounded-2xl border border-border/70 bg-card/80 p-5">
              <div className="space-y-1">
                <h3 className="font-semibold text-foreground">Loop defaults</h3>
                <p className="text-sm text-muted-foreground">
                  These defaults apply across teach, guide, and custom activity modes in this phase.
                </p>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">Enable dual loop</span>
                      <InfoBadge copy="When enabled, the tutor drafts a reply and the supervisor reviews it before the student sees it." />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Turning this off falls back to a single tutor pass.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setAiPolicy((current) => ({
                        ...current,
                        dualLoopEnabled: !current.dualLoopEnabled,
                      }))
                    }
                    className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${
                      aiPolicy.dualLoopEnabled ? 'bg-primary' : 'bg-secondary'
                    }`}
                    aria-pressed={aiPolicy.dualLoopEnabled}
                  >
                    <span
                      className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${
                        aiPolicy.dualLoopEnabled ? 'translate-x-7' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  Default tutor model
                </label>
                <Select
                  value={aiPolicy.defaultTutorModelId ?? undefined}
                  onValueChange={(value) =>
                    setAiPolicy((current) => ({
                      ...current,
                      defaultTutorModelId: value || null,
                    }))
                  }
                  disabled={!hasAllowedTutorModels}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={
                        hasAllowedTutorModels
                          ? 'Select a model'
                          : 'Choose allowed tutor models first'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {aiModels
                      .filter((model) => aiPolicy.allowedTutorModelIds.includes(model.modelId))
                      .map((model) => (
                        <SelectItem key={model.id} value={model.modelId}>
                          {model.modelName}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  Default supervisor model
                </label>
                <Select
                  value={aiPolicy.defaultSupervisorModelId ?? undefined}
                  onValueChange={(value) =>
                    setAiPolicy((current) => ({
                      ...current,
                      defaultSupervisorModelId: value || null,
                    }))
                  }
                  disabled={!aiModels.length}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={aiModels.length ? 'Select a model' : 'No models available'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {aiModels.map((model) => (
                      <SelectItem key={model.id} value={model.modelId}>
                        {model.modelName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Pick the more careful model here, even if it is slower or more expensive.
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  Max revision passes
                </label>
                <Input
                  type="number"
                  min={1}
                  max={5}
                  value={aiPolicy.maxSupervisorIterations}
                  onChange={(e) =>
                    setAiPolicy((current) => ({
                      ...current,
                      maxSupervisorIterations: clampIterations(e.target.value),
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Three passes is a good default: enough room for correction without producing a
                  slow experience.
                </p>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-4 text-sm text-muted-foreground space-y-2">
                <p className="font-medium text-foreground">Before you save</p>
                <p>
                  Choose at least one tutor model, then set a tutor default and a supervisor
                  default. Tutor defaults shape the student experience. Supervisor defaults shape
                  safety.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  type="button"
                  onClick={saveAiPolicy}
                  disabled={
                    savingAiPolicy ||
                    !aiPolicyAvailable ||
                    !aiPolicyDirty ||
                    !hasAllowedTutorModels ||
                    !aiPolicy.defaultTutorModelId ||
                    !aiPolicy.defaultSupervisorModelId
                  }
                  variant="primary"
                >
                  {savingAiPolicy ? 'Saving…' : 'Save loop settings'}
                </Button>
                <Button
                  type="button"
                  onClick={() => setAiPolicy(initialAiPolicy)}
                  disabled={savingAiPolicy || !aiPolicyDirty}
                  variant="secondary"
                >
                  Reset changes
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-foreground">EduAI API Key</h2>
            <p className="text-sm text-muted-foreground max-w-2xl">
              {status.envConfigured ? (
                <>
                  A default key is already set up for this server. Saving a key here will use it
                  instead. Clear it to go back to the default key.
                </>
              ) : (
                <>No default key is set up for this server yet. You can set one here.</>
              )}
            </p>
            {updatedLabel && status.hasAdminOverride && (
              <p className="text-xs text-muted-foreground">
                Last updated: <span className="font-mono">{updatedLabel}</span>
              </p>
            )}
          </div>

          <div className="space-y-3">
            <label className="block text-sm font-medium text-foreground">New key</label>
            <div className="flex flex-col sm:flex-row gap-3">
              <Input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                type={showKey ? 'text' : 'password'}
                className="flex-1"
                placeholder="Paste EDUAI API key"
                autoComplete="off"
              />
              <Button type="button" onClick={() => setShowKey((v) => !v)} variant="secondary">
                {showKey ? 'Hide' : 'Show'}
              </Button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button type="button" onClick={save} disabled={saving || !apiKey.trim()} variant="primary">
              {saving ? 'Saving…' : 'Save key'}
            </Button>
            <Button
              type="button"
              onClick={clear}
              disabled={clearing || !status.hasAdminOverride}
              variant="secondary"
              title={!status.hasAdminOverride ? 'No key to clear' : undefined}
            >
              {clearing ? 'Clearing…' : 'Clear key'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoBadge({ copy }: { copy: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-[11px] font-bold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          aria-label="More information"
        >
          i
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px]">
        <p>{copy}</p>
      </TooltipContent>
    </Tooltip>
  );
}
