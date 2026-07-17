import { useState, useEffect } from "react";
import { DB_STORED_KEY } from "~/hooks/use-api-keys";
import { Button } from "@eduai/ui";
import { Input } from "@eduai/ui";
import { Label } from "@eduai/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@eduai/ui";
import { Badge } from "@eduai/ui";
import { Textarea } from "@eduai/ui";
import {
  PageTabs,
  PageTabsList,
  PageTabsTrigger,
  PageTabsContent,
} from "@eduai/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@eduai/ui";
import {
  IconSettings,
  IconEye,
  IconEyeOff,
  IconExternalLink,
  IconShield,
  IconTrash,
} from "@tabler/icons-react";
import type { UserProviderSettings } from "~/lib/ai/providers";

type Provider = "openai" | "google";

export interface ApiKeySettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiKeys: UserProviderSettings;
  isProviderConfigured: (provider: Provider) => boolean;
  onUpdateProvider: (
    provider: Provider,
    settings: { apiKey?: string; isEnabled: boolean }
  ) => void;
  onRemoveProvider: (provider: Provider) => void;
  systemPrompt?: string | null;
  onSystemPromptSave?: (p: string | null) => void;
}

export function ApiKeySettings({
  open,
  onOpenChange,
  apiKeys,
  isProviderConfigured,
  onUpdateProvider,
  onRemoveProvider,
  systemPrompt,
  onSystemPromptSave,
}: ApiKeySettingsProps) {
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [tempKeys, setTempKeys] = useState<Record<string, string>>({});
  const [prompt, setPrompt] = useState(systemPrompt || "");
  const [activeProvider, setActiveProvider] = useState<Provider>("openai");

  useEffect(() => {
    setPrompt(systemPrompt || "");
  }, [systemPrompt]);

  const handleSaveKey = (provider: Provider) => {
    const key = tempKeys[provider]?.trim();
    if (key) {
      onUpdateProvider(provider, { apiKey: key, isEnabled: true });
      setTempKeys((prev) => ({ ...prev, [provider]: "" }));
    }
  };

  const handleRemoveKey = (provider: Provider) => {
    onRemoveProvider(provider);
    setTempKeys((prev) => ({ ...prev, [provider]: "" }));
  };

  const toggleShowKey = (provider: string) => {
    setShowKeys((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  const maskKey = (key: string) => {
    if (!key) return "";
    if (key.length <= 8)
      return key.substring(0, 2) + "•".repeat(Math.max(4, key.length - 2));
    return key.substring(0, 8) + "•".repeat(Math.max(0, key.length - 8));
  };

  const handleSystemPromptSave = () => {
    onSystemPromptSave?.(prompt.trim() || null);
  };

  const handleSystemPromptClear = () => {
    setPrompt("");
    onSystemPromptSave?.(null);
  };

  const providers: Array<{
    id: Provider;
    label: string;
    description: string;
    placeholder: string;
    learnMoreLabel: string;
    learnMoreHref: string;
  }> = [
    {
      id: "openai",
      label: "OpenAI",
      description: "For GPT models and other OpenAI services",
      placeholder: "sk-...",
      learnMoreLabel: "OpenAI Platform",
      learnMoreHref: "https://platform.openai.com/api-keys",
    },
    {
      id: "google",
      label: "Google AI",
      description: "For Gemini models and Google AI services",
      placeholder: "AIza...",
      learnMoreLabel: "Google AI Studio",
      learnMoreHref: "https://aistudio.google.com/app/apikey",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-[var(--radius-xl)] shadow-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-primary-text">
            <IconSettings className="h-5 w-5 shrink-0" />
            Chat settings
          </DialogTitle>
          <DialogDescription>
            Customize your system prompt and configure API keys to use your personal quotas and credits.
          </DialogDescription>
        </DialogHeader>

        <PageTabs defaultValue={onSystemPromptSave ? "prompt" : "keys"} className="py-1">
          <PageTabsList>
            {onSystemPromptSave && (
              <PageTabsTrigger value="prompt">System prompt</PageTabsTrigger>
            )}
            <PageTabsTrigger value="keys">API keys</PageTabsTrigger>
          </PageTabsList>

          {onSystemPromptSave && (
            <PageTabsContent value="prompt">
              <div className="rounded-[var(--radius-md)] border border-border bg-card p-4 space-y-3">
                <div>
                  <Label
                    htmlFor="system-prompt-edit"
                    className="text-sm font-semibold text-foreground"
                  >
                    System prompt
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Customize how the AI behaves in this chat.
                  </p>
                </div>
                <Textarea
                  id="system-prompt-edit"
                  placeholder="Enter a custom system prompt (leave empty to use default)..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="min-h-[160px] font-mono text-sm rounded-[var(--radius-md)]"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSystemPromptSave}
                    className="flex-1 rounded-[var(--radius-base)]"
                  >
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSystemPromptClear}
                    disabled={!prompt.trim()}
                    className="flex-1 rounded-[var(--radius-base)]"
                  >
                    Clear
                  </Button>
                </div>
              </div>
            </PageTabsContent>
          )}

          <PageTabsContent value="keys" className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Provider
              </Label>
              <Select
                value={activeProvider}
                onValueChange={(value) => setActiveProvider(value as Provider)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

          {providers
            .filter((p) => p.id === activeProvider)
            .map((p) => {
            const configured = isProviderConfigured(p.id);
            return (
                <section
                  key={p.id}
                  className="space-y-3 rounded-[var(--radius-md)] border border-border bg-card p-4"
                >
                  {/* Section header */}
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground leading-tight">
                        {p.label} API key
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {p.description}
                      </p>
                    </div>
                    {configured && (
                      <Badge
                        variant="secondary"
                        className="shrink-0 gap-1 text-xs"
                      >
                        <IconShield className="h-3 w-3" />
                        Active
                      </Badge>
                    )}
                  </div>

                  {/* Key input / display row */}
                  {configured ? (
                    <div className="space-y-2">
                      <Label className="sr-only" htmlFor={`key-display-${p.id}`}>
                        {p.label} API key
                      </Label>
                      <div className="flex items-center gap-2">
                        {apiKeys[p.id]?.apiKey === DB_STORED_KEY ? (
                          <Input
                            id={`key-display-${p.id}`}
                            type="password"
                            value="stored-securely"
                            readOnly
                            className="font-mono text-sm rounded-[var(--radius-md)] flex-1 text-muted-foreground"
                            aria-label={`${p.label} API key stored securely`}
                          />
                        ) : (
                          <>
                            <Input
                              id={`key-display-${p.id}`}
                              type={showKeys[p.id] ? "text" : "password"}
                              value={
                                showKeys[p.id]
                                  ? (apiKeys[p.id]?.apiKey ?? "")
                                  : maskKey(apiKeys[p.id]?.apiKey ?? "")
                              }
                              readOnly
                              className="font-mono text-sm rounded-[var(--radius-md)] flex-1"
                            />
                            <button
                              type="button"
                              onClick={() => toggleShowKey(p.id)}
                              aria-label={showKeys[p.id] ? "Hide API key" : "Reveal API key"}
                              className="inline-flex items-center justify-center h-11 w-11 shrink-0 rounded-[var(--radius-md)] border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {showKeys[p.id] ? (
                                <IconEyeOff className="h-4 w-4" />
                              ) : (
                                <IconEye className="h-4 w-4" />
                              )}
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRemoveKey(p.id)}
                          aria-label={`Remove ${p.label} API key`}
                          className="inline-flex items-center justify-center h-11 w-11 shrink-0 rounded-[var(--radius-md)] border border-border bg-background text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <IconTrash className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label
                        htmlFor={`key-input-${p.id}`}
                        className="text-xs text-muted-foreground"
                      >
                        Paste your key
                      </Label>
                      <Input
                        id={`key-input-${p.id}`}
                        type="password"
                        placeholder={p.placeholder}
                        value={tempKeys[p.id] ?? ""}
                        onChange={(e) =>
                          setTempKeys((prev) => ({
                            ...prev,
                            [p.id]: e.target.value,
                          }))
                        }
                        className="font-mono text-sm rounded-[var(--radius-md)]"
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleSaveKey(p.id)}
                        disabled={!tempKeys[p.id]?.trim()}
                        className="w-full rounded-[var(--radius-base)]"
                      >
                        Save {p.label} key
                      </Button>
                    </div>
                  )}

                  {/* Provider link */}
                  <p className="text-xs text-muted-foreground">
                    Get your key from{" "}
                    <a
                      href={p.learnMoreHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--secondary)] hover:underline inline-flex items-center gap-0.5"
                    >
                      {p.learnMoreLabel}
                      <IconExternalLink className="h-3 w-3" />
                    </a>
                  </p>
                </section>
            );
          })}

          {/* Self-hosted providers note */}
          <div className="mt-5 rounded-[var(--radius-md)] border border-border bg-muted/40 px-4 py-3 space-y-1.5">
            <p className="text-xs font-medium text-foreground">
              Self-hosted providers (Ollama, vLLM)
            </p>
            <p className="text-xs text-muted-foreground">
              Managed on the server via <code className="font-mono">OLLAMA_BASE_URL</code> and{" "}
              <code className="font-mono">VLLM_BASE_URL</code> in{" "}
              <code className="font-mono">apps/core/.env</code>. Select{" "}
              <code className="font-mono">ollama:</code> or{" "}
              <code className="font-mono">vllm:</code> models in chat when
              configured.
            </p>
            <p className="text-xs text-muted-foreground">
              Docs:{" "}
              <code className="font-mono">docs/rag-ai/VLLM.md</code>,{" "}
              <code className="font-mono">
                docs/rag-ai/HOW_TO_USE_DEV_SERVER.md
              </code>
            </p>
          </div>

          {/* Security note */}
          <div className="mt-3 flex items-start gap-2 rounded-[var(--radius-md)] border border-border bg-muted/40 px-4 py-3">
            <IconShield className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              API keys are encrypted and stored securely on the server. They are
              never exposed to other users or returned to the browser.
            </p>
          </div>
          </PageTabsContent>
        </PageTabs>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-[var(--radius-base)]"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
