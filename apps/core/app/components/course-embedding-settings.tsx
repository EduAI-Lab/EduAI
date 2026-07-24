import { useCallback, useEffect, useMemo, useState } from "react";
import { IconAlertCircle, IconCircleCheck, IconLoader, IconRefresh } from "@tabler/icons-react";
import { Alert, AlertDescription } from "@eduai/ui";
import { Button } from "@eduai/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@eduai/ui";
import { Checkbox } from "@eduai/ui";
import { Label } from "@eduai/ui";
import { readJsonResponse } from "~/lib/api/client";
import {
  formatReEmbedJobMessage,
  pollReEmbedJobUntilDone,
} from "~/lib/api/re-embed-job.client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@eduai/ui";

type ModelOption = { id: string; label: string };

type EmbeddingSettingsResponse = {
  settings: {
    embeddingProvider: string | null;
    embeddingModel: string | null;
    embeddedWithProvider: string | null;
    embeddedWithModel: string | null;
    lastEmbeddedAt: string | null;
  };
  effective: {
    provider: string;
    model: string;
    source: { provider: string; model: string };
  };
  needsReEmbed: boolean;
  allowedLocalModels: ModelOption[];
  allowedCloudModels: ModelOption[];
};

type CourseEmbeddingSettingsProps = {
  courseId: string;
  onSettingsSaved?: () => void;
};

const PROVIDER_OPTIONS = [
  { value: "env", label: "Server default" },
  { value: "local", label: "Local (Ollama)" },
  { value: "cloud", label: "Cloud" },
] as const;

export function CourseEmbeddingSettings({ courseId, onSettingsSaved }: CourseEmbeddingSettingsProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [data, setData] = useState<EmbeddingSettingsResponse | null>(null);
  const [providerChoice, setProviderChoice] = useState<string>("env");
  const [modelChoice, setModelChoice] = useState<string>("default");
  const [reEmbedOnSave, setReEmbedOnSave] = useState(false);
  const [reEmbedProgress, setReEmbedProgress] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/courses/${courseId}/embedding-settings`);
      const parsed = await readJsonResponse<EmbeddingSettingsResponse & { error?: string; hint?: string }>(response);

      if (!parsed.ok) {
        throw new Error(parsed.error);
      }

      const result = parsed.data;
      if (!response.ok) {
        throw new Error(
          [result.error, result.hint].filter(Boolean).join(" ") || "Failed to load search settings",
        );
      }

      setData(result);
      setProviderChoice(result.settings.embeddingProvider ?? "env");
      setModelChoice(result.settings.embeddingModel ?? "default");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load search settings");
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const modelOptions = useMemo(() => {
    if (!data) return [];
    if (providerChoice === "local") return data.allowedLocalModels ?? [];
    if (providerChoice === "cloud") return data.allowedCloudModels ?? [];
    return [];
  }, [data, providerChoice]);

  const handleProviderChange = (value: string) => {
    setProviderChoice(value);
    setModelChoice("default");
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const payload: Record<string, unknown> = {
        embeddingProvider: providerChoice === "env" ? null : providerChoice,
        embeddingModel: modelChoice === "default" ? null : modelChoice,
        reEmbed: reEmbedOnSave,
      };

      const response = await fetch(`/api/courses/${courseId}/embedding-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const parsed = await readJsonResponse<
        EmbeddingSettingsResponse & {
          success?: boolean;
          error?: string;
          hint?: string;
          reEmbedJob?: { id: string };
        }
      >(response);

      if (!parsed.ok) {
        throw new Error(parsed.error);
      }

      const result = parsed.data;
      if (!response.ok) {
        throw new Error([result.error, result.hint].filter(Boolean).join(" ") || "Failed to save search settings");
      }

      setData((prev) => ({
        settings: result.settings,
        effective: result.effective,
        needsReEmbed: result.needsReEmbed,
        allowedLocalModels:
          result.allowedLocalModels ?? prev?.allowedLocalModels ?? [],
        allowedCloudModels:
          result.allowedCloudModels ?? prev?.allowedCloudModels ?? [],
      }));
      setProviderChoice(result.settings.embeddingProvider ?? "env");
      setModelChoice(result.settings.embeddingModel ?? "default");

      if (result.reEmbedJob?.id) {
        setReEmbedProgress("Processing materials…");
        const finalJob = await pollReEmbedJobUntilDone(courseId, result.reEmbedJob.id, {
          onUpdate: (job) => {
            if (job.currentMaterialTitle) {
              setReEmbedProgress(
                `Processing ${job.processedCount + 1}/${job.totalMaterials}: ${job.currentMaterialTitle}`,
              );
            } else if (job.totalMaterials > 0) {
              setReEmbedProgress(`Processing ${job.processedCount}/${job.totalMaterials}…`);
            }
          },
        });
        setReEmbedProgress(null);
        if (finalJob.status === "FAILED") {
          throw new Error(finalJob.errorMessage || "Processing failed after saving settings");
        }
        await loadSettings();
        setSuccess(`Settings saved. ${formatReEmbedJobMessage(finalJob)}`);
        onSettingsSaved?.();
      } else if (result.needsReEmbed) {
        setSuccess("Settings saved. Reprocess materials so course chat uses the new model.");
      } else {
        setSuccess("Search settings saved.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
      setReEmbedProgress(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-muted-foreground">
          <IconLoader className="h-4 w-4 animate-spin" />
          Loading search settings…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Search settings</CardTitle>
        <CardDescription>
          Choose the AI model used to search this course&apos;s materials. Changing the model
          requires reprocessing your materials.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data && (
          <div className="rounded-md border p-3 text-sm text-muted-foreground space-y-1">
            <p>
              Active: <span className="font-medium text-foreground">{data.effective.provider}</span> /{" "}
              <span className="font-medium text-foreground">{data.effective.model}</span>
              {data.effective.source.provider === "env" && " (from server env)"}
            </p>
            {data.settings.embeddedWithModel && (
              <p>
                Last processed with: {data.settings.embeddedWithProvider} / {data.settings.embeddedWithModel}
                {data.settings.lastEmbeddedAt &&
                  ` · ${new Date(data.settings.lastEmbeddedAt).toLocaleString()}`}
              </p>
            )}
          </div>
        )}

        {data?.needsReEmbed && (
          <Alert>
            <IconAlertCircle className="h-4 w-4" />
            <AlertDescription>
              Materials were processed with a different model. Reprocess all materials before course
              chat can search them accurately.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="embedding-provider">Provider</Label>
            <Select value={providerChoice} onValueChange={handleProviderChange}>
              <SelectTrigger id="embedding-provider" className="w-full">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {providerChoice !== "env" && (
            <div className="space-y-2">
              <Label htmlFor="embedding-model">Model</Label>
              <Select value={modelChoice} onValueChange={setModelChoice}>
                <SelectTrigger id="embedding-model" className="w-full">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Provider default</SelectItem>
                  {modelOptions.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="re-embed-on-save"
            checked={reEmbedOnSave}
            onCheckedChange={(checked) => setReEmbedOnSave(checked === true)}
          />
          <Label htmlFor="re-embed-on-save" className="font-normal">
            Reprocess all materials after saving
          </Label>
        </div>

        {error && (
          <Alert variant="destructive">
            <IconAlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert>
            <IconCircleCheck className="h-4 w-4" />
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <IconLoader className="mr-2 h-4 w-4 animate-spin" />
              {reEmbedProgress ?? "Saving…"}
            </>
          ) : (
            <>
              <IconRefresh className="mr-2 h-4 w-4" />
              Save settings
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
