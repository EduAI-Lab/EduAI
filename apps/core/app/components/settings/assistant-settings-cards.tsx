/**
 * Admin controls for the help assistant (#1817). On/off switches live with the
 * other feature toggles on the admin Settings page; tuning lives on the AI Models
 * page with the rest of the AI configuration. Both save through
 * `PATCH /api/admin/assistant-settings`, which re-checks the ADMIN role itself.
 */
import { useState } from "react";
import { z } from "zod";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@eduai/ui";

import {
  ASSISTANT_DISPLAY_NAME,
  ASSISTANT_MAX_DOCS_MAX,
  ASSISTANT_MAX_DOCS_MIN,
  ASSISTANT_SETTING_DEFINITIONS,
  type AssistantSettings,
} from "~/lib/assistant/assistant-settings";

type SaveSettings = (patch: Partial<AssistantSettings>) => Promise<AssistantSettings>;

/** `PATCH /api/admin/assistant-settings`'s body, parsed at the boundary. */
const adminSettingsResponse = z
  .object({
    settings: z
      .object({
        enableHelpAssistant: z.boolean(),
        enableStudentMaterialQuestions: z.boolean(),
        maxDocs: z.number(),
        routerModel: z.string(),
        defaultModel: z.string(),
      })
      .optional(),
    error: z.string().optional(),
  })
  .catch({});

export async function patchAssistantSettings(
  patch: Partial<AssistantSettings>,
): Promise<AssistantSettings> {
  const response = await fetch("/api/admin/assistant-settings", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = adminSettingsResponse.parse(await response.json().catch(() => null));
  if (!response.ok || !body.settings) throw new Error(body.error ?? "Failed to save");
  return body.settings;
}

function useSaver(initial: AssistantSettings, onSave: SaveSettings) {
  const [settings, setSettings] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async (patch: Partial<AssistantSettings>) => {
    setSaving(true);
    setError(null);
    try {
      setSettings(await onSave(patch));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save");
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { settings, error, saving, save };
}

export function AssistantToggleCard({
  initialSettings,
  onSave = patchAssistantSettings,
}: {
  initialSettings: AssistantSettings;
  onSave?: SaveSettings;
}) {
  const { settings, error, saving, save } = useSaver(initialSettings, onSave);
  const toggles = ["enableHelpAssistant", "enableStudentMaterialQuestions"] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Help assistant ({ASSISTANT_DISPLAY_NAME})</CardTitle>
        <CardDescription>
          A floating assistant on every signed-in page that answers only from the role-scoped user
          guide and, where allowed, the course material being viewed. The platform kill switch under
          General stops it for everyone, administrators included.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {toggles.map((key) => (
          <div key={key} className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor={`assistant-${key}`} className="text-base">
                {ASSISTANT_SETTING_DEFINITIONS[key].label}
              </Label>
              <p className="text-muted-foreground text-sm">
                {ASSISTANT_SETTING_DEFINITIONS[key].description}
              </p>
            </div>
            <Switch
              id={`assistant-${key}`}
              aria-label={ASSISTANT_SETTING_DEFINITIONS[key].label}
              checked={settings[key]}
              disabled={saving}
              onCheckedChange={(value) => void save({ [key]: value })}
            />
          </div>
        ))}
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

const NONE = "__none__";

export function AssistantTuningCard({
  initialSettings,
  modelOptions,
  onSave = patchAssistantSettings,
}: {
  initialSettings: AssistantSettings;
  /** `provider:model` ids from the active chat catalogue. */
  modelOptions: string[];
  onSave?: SaveSettings;
}) {
  const { settings, error, saving, save } = useSaver(initialSettings, onSave);
  const [draft, setDraft] = useState({
    maxDocs: initialSettings.maxDocs,
    routerModel: initialSettings.routerModel,
    defaultModel: initialSettings.defaultModel,
  });
  const [saved, setSaved] = useState(false);

  const modelSelect = (key: "routerModel" | "defaultModel", noneLabel: string) => {
    // Keep a stored value visible even if it has since left the catalogue.
    const options =
      draft[key] && !modelOptions.includes(draft[key])
        ? [draft[key], ...modelOptions]
        : modelOptions;
    return (
      <Select
        value={draft[key] || NONE}
        onValueChange={(value) => {
          setSaved(false);
          setDraft((current) => ({ ...current, [key]: value === NONE ? "" : value }));
        }}
      >
        <SelectTrigger id={`assistant-${key}`} className="w-full max-w-md">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{noneLabel}</SelectItem>
          {options.map((id) => (
            <SelectItem key={id} value={id}>
              {id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Help assistant tuning</CardTitle>
        <CardDescription>
          How {ASSISTANT_DISPLAY_NAME} retrieves and which model answers when a user has not chosen
          one. Turn the assistant on or off under Admin → Settings.
          {settings.enableHelpAssistant ? "" : " It is currently off."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="space-y-2">
          <Label htmlFor="assistant-maxDocs">{ASSISTANT_SETTING_DEFINITIONS.maxDocs.label}</Label>
          <p className="text-muted-foreground text-sm">
            {ASSISTANT_SETTING_DEFINITIONS.maxDocs.description}
          </p>
          <Select
            value={String(draft.maxDocs)}
            onValueChange={(value) => {
              setSaved(false);
              setDraft((current) => ({ ...current, maxDocs: Number(value) }));
            }}
          >
            <SelectTrigger id="assistant-maxDocs" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from(
                { length: ASSISTANT_MAX_DOCS_MAX - ASSISTANT_MAX_DOCS_MIN + 1 },
                (_, index) => ASSISTANT_MAX_DOCS_MIN + index,
              ).map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="assistant-defaultModel">
            {ASSISTANT_SETTING_DEFINITIONS.defaultModel.label}
          </Label>
          <p className="text-muted-foreground text-sm">
            {ASSISTANT_SETTING_DEFINITIONS.defaultModel.description}
          </p>
          {modelSelect("defaultModel", "First usable model in the catalogue")}
        </div>
        <div className="space-y-2">
          <Label htmlFor="assistant-routerModel">
            {ASSISTANT_SETTING_DEFINITIONS.routerModel.label}
          </Label>
          <p className="text-muted-foreground text-sm">
            {ASSISTANT_SETTING_DEFINITIONS.routerModel.description}
          </p>
          {modelSelect("routerModel", "Same as the answer model")}
        </div>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="text-muted-foreground text-sm" role="status">
            Assistant tuning saved.
          </p>
        ) : null}
        <div>
          <Button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaved(await save(draft));
            }}
          >
            {saving ? "Saving…" : "Save assistant tuning"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
