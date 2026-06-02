import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle, Loader2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

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

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/courses/${courseId}/embedding-settings`);
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Failed to load embedding settings");
      }
      setData(result);
      setProviderChoice(result.settings.embeddingProvider ?? "env");
      setModelChoice(result.settings.embeddingModel ?? "default");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const modelOptions = useMemo(() => {
    if (!data) return [];
    if (providerChoice === "local") return data.allowedLocalModels;
    if (providerChoice === "cloud") return data.allowedCloudModels;
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
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to save embedding settings");
      }

      setData(result);
      setProviderChoice(result.settings.embeddingProvider ?? "env");
      setModelChoice(result.settings.embeddingModel ?? "default");

      if (result.reEmbed) {
        setSuccess(
          `Settings saved. Re-indexed ${result.reEmbed.processed} material(s)` +
            (result.reEmbed.failed?.length ? ` (${result.reEmbed.failed.length} failed)` : "") +
            ".",
        );
        onSettingsSaved?.();
      } else if (result.needsReEmbed) {
        setSuccess("Settings saved. Re-index materials so RAG uses the new embedding model.");
      } else {
        setSuccess("Embedding settings saved.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading embedding settings…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Embedding settings</CardTitle>
        <CardDescription>
          Choose which embedding model indexes this course&apos;s materials. All models use 1024
          dimensions; changing the model requires re-indexing.
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
                Indexed with: {data.settings.embeddedWithProvider} / {data.settings.embeddedWithModel}
                {data.settings.lastEmbeddedAt &&
                  ` · ${new Date(data.settings.lastEmbeddedAt).toLocaleString()}`}
              </p>
            )}
          </div>
        )}

        {data?.needsReEmbed && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Materials were indexed with a different model. Re-index all materials before relying on
              course chat RAG.
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
            Re-index all materials after saving
          </Label>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Save settings
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
