/**
 * The assistant's in-panel settings (#1823): which provider and model answer, and
 * the user's own key — without leaving the conversation.
 *
 * Every option is fetched from the server each time the pane opens, never baked
 * into the page, and a save shows the state the server re-read. The key field is
 * write-only: never seeded, and cleared from component state the moment a save
 * succeeds, so plaintext never lingers in a client snapshot.
 */
import { useEffect, useMemo, useState } from "react";
import { IconArrowLeft, IconLoader2 } from "@tabler/icons-react";
import {
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@eduai/ui";

import {
  fetchAssistantSettings,
  fetchProviderModels,
  resetAssistantSettings,
  saveAssistantSettings,
  type AssistantUserSettings,
  type SaveAssistantSettingsRequest,
  type SettingsCallResult,
} from "./assistant-api";

const KEY_SOURCE_COPY = {
  SAVED: "your own key",
  PLATFORM: "the platform's key",
  PASTED: "a key sent with the request",
} as const;

export function AssistantSettingsPane({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<AssistantUserSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [liveModels, setLiveModels] = useState<string[] | null>(null);
  const [curated, setCurated] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<"save" | "reset" | "remove" | "fetch" | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const adopt = (next: AssistantUserSettings) => {
    setSettings(next);
    const chosen =
      next.preferred?.provider ?? next.effective?.provider ?? next.providers[0]?.name ?? "";
    setProvider(chosen);
    const option = next.providers.find((entry) => entry.name === chosen);
    const wanted = next.preferred?.model ?? next.effective?.model ?? "";
    setModel(option?.offeredModels.includes(wanted) ? wanted : (option?.offeredModels[0] ?? ""));
    setCurated(option?.userModels ?? null);
    setLiveModels(null);
  };

  useEffect(() => {
    let cancelled = false;
    void fetchAssistantSettings().then((result) => {
      if (cancelled) return;
      if (result.ok) adopt(result.data);
      else setLoadError(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const option = settings?.providers.find((entry) => entry.name === provider) ?? null;
  const dropdownModels = useMemo(() => {
    if (!option) return [];
    const own = option.hasOwnKey && curated ? curated : [];
    return [...new Set([...option.adminModels, ...own])];
  }, [option, curated]);

  const selectProvider = (name: string) => {
    setProvider(name);
    const next = settings?.providers.find((entry) => entry.name === name);
    setModel(next?.offeredModels[0] ?? "");
    setCurated(next?.userModels ?? null);
    setLiveModels(null);
    setApiKey("");
    setStatus(null);
  };

  const run = async (
    kind: NonNullable<typeof busy>,
    call: () => Promise<SettingsCallResult<AssistantUserSettings>>,
    done: string,
  ) => {
    setBusy(kind);
    setStatus(null);
    const result = await call();
    setBusy(null);
    if (result.ok) {
      // Write-only: the key leaves component state as soon as the server has it.
      setApiKey("");
      adopt(result.data);
      setStatus({ tone: "ok", text: done });
    } else {
      setStatus({ tone: "error", text: result.message });
    }
  };

  const save = () => {
    const request: SaveAssistantSettingsRequest = { provider, model };
    // Only a typed key is sent; an empty field means "keep the saved key".
    if (apiKey.trim()) request.apiKey = apiKey.trim();
    if (curated !== (option?.userModels ?? null)) request.enabledModels = curated;
    return run("save", () => saveAssistantSettings(request), "Saved.");
  };

  const removeKey = () =>
    run(
      "remove",
      () => saveAssistantSettings({ provider, model, removeKey: true }),
      "Key removed.",
    );

  const reset = () =>
    run("reset", resetAssistantSettings, "Back to the default. Your saved keys were kept.");

  const fetchModels = async () => {
    setBusy("fetch");
    setStatus(null);
    const result = await fetchProviderModels(provider);
    setBusy(null);
    if (result.ok) {
      setLiveModels(result.data.models);
      setCurated((current) => current ?? []);
    } else {
      setStatus({ tone: "error", text: result.message });
    }
  };

  const toggleCurated = (id: string, checked: boolean) =>
    setCurated((current) => {
      const base = current ?? [];
      return checked ? [...new Set([...base, id])] : base.filter((entry) => entry !== id);
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack} className="gap-1.5 px-2">
          <IconArrowLeft className="size-4" aria-hidden />
          Back to conversation
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3 text-sm">
        {loadError ? (
          <div role="alert" className="text-destructive">
            {loadError}
          </div>
        ) : !settings ? (
          <div className="text-muted-foreground flex items-center gap-2">
            <IconLoader2 className="size-4 animate-spin" aria-hidden /> Loading settings…
          </div>
        ) : settings.providers.length === 0 ? (
          <div className="text-muted-foreground">No AI providers are enabled on this platform.</div>
        ) : (
          <>
            <div className="text-muted-foreground rounded-md bg-muted/60 px-3 py-2 text-xs">
              {settings.effective ? (
                <>
                  Questions currently run on{" "}
                  <span className="font-medium text-foreground">
                    {settings.providers.find((entry) => entry.name === settings.effective?.provider)
                      ?.displayName ?? settings.effective.provider}{" "}
                    · {settings.effective.model}
                  </span>{" "}
                  using {KEY_SOURCE_COPY[settings.effective.keySource]}.
                </>
              ) : (
                <>No provider is usable for you yet. Save your own key below to start asking.</>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assistant-provider">Provider</Label>
              <Select value={provider} onValueChange={selectProvider}>
                <SelectTrigger id="assistant-provider" className="w-full">
                  <SelectValue placeholder="Choose a provider" />
                </SelectTrigger>
                <SelectContent>
                  {settings.providers.map((entry) => (
                    <SelectItem key={entry.name} value={entry.name}>
                      {entry.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assistant-model">Model</Label>
              {dropdownModels.length > 0 ? (
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger id="assistant-model" className="w-full">
                    <SelectValue placeholder="Choose a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {dropdownModels.map((id) => (
                      <SelectItem key={id} value={id}>
                        {id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-muted-foreground text-xs">
                  {option?.hasOwnKey && curated !== null
                    ? "You haven't enabled any models for this provider. Fetch the list and tick the ones you want."
                    : "The administrator hasn't enabled any models for this provider."}
                </p>
              )}
            </div>

            {option?.requiresKey ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="assistant-key">Your API key for {option.displayName}</Label>
                <p className="text-muted-foreground text-xs">
                  {option.hasOwnKey
                    ? `Saved key ending ${option.maskedKey?.slice(-4) ?? "••••"}. It is never shown again.`
                    : option.platformAvailable
                      ? "No key saved — questions use the platform's key."
                      : "No key saved. This provider needs your own key."}
                </p>
                <Input
                  id="assistant-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={
                    option.hasOwnKey ? "Replace with a new key" : "Paste a key to save it"
                  }
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
                {option.hasOwnKey ? (
                  <div>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto px-0 text-destructive"
                      onClick={() => void removeKey()}
                      disabled={busy !== null}
                    >
                      Remove saved key
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {option?.canFetchModels ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">Models from your own account</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void fetchModels()}
                    disabled={busy !== null || !option.hasOwnKey}
                    title={option.hasOwnKey ? undefined : "Save your own key first"}
                  >
                    {busy === "fetch" ? "Fetching…" : "Fetch models"}
                  </Button>
                </div>
                {!option.hasOwnKey ? (
                  <p className="text-muted-foreground text-xs">
                    Fetching needs your own key — the platform's key is never used to browse models.
                  </p>
                ) : null}
                {liveModels ? (
                  <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
                    {liveModels.map((id) => (
                      <li key={id} className="flex items-center gap-2">
                        <Checkbox
                          id={`assistant-model-${id}`}
                          checked={curated?.includes(id) ?? false}
                          onCheckedChange={(checked) => toggleCurated(id, checked === true)}
                        />
                        <label htmlFor={`assistant-model-${id}`} className="truncate text-xs">
                          {id}
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {status ? (
              <div
                role={status.tone === "error" ? "alert" : "status"}
                className={
                  status.tone === "error"
                    ? "text-destructive text-xs"
                    : "text-muted-foreground text-xs"
                }
              >
                {status.text}
              </div>
            ) : null}
          </>
        )}
      </div>

      {settings && settings.providers.length > 0 ? (
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void reset()}
            disabled={busy !== null}
          >
            Use the default
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void save()}
            disabled={busy !== null || !provider || !model}
          >
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
