import { useState } from "react";
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
import {
  PageTabs,
  PageTabsList,
  PageTabsTrigger,
  PageTabsContent,
} from "@eduai/ui";
import {
  IconKey,
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
}

export function ApiKeySettings({
  open,
  onOpenChange,
  apiKeys,
  isProviderConfigured,
  onUpdateProvider,
  onRemoveProvider,
}: ApiKeySettingsProps) {
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [tempKeys, setTempKeys] = useState<Record<string, string>>({});

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
      <DialogContent className="rounded-[var(--radius-xl)] shadow-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-primary-text">
            <IconKey className="h-5 w-5 shrink-0" />
            API key settings
          </DialogTitle>
          <DialogDescription>
            Configure your own API keys to use your personal quotas and credits.
          </DialogDescription>
        </DialogHeader>

        <PageTabs defaultValue="openai" className="py-1">
          <PageTabsList>
            {providers.map((p) => (
              <PageTabsTrigger key={p.id} value={p.id}>
                {p.label}
              </PageTabsTrigger>
            ))}
          </PageTabsList>

          {providers.map((p) => {
            const configured = isProviderConfigured(p.id);
            return (
              <PageTabsContent key={p.id} value={p.id}>
                <section className="space-y-3 rounded-[var(--radius-md)] border border-border bg-card p-4">
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
                          aria-label={
                            showKeys[p.id] ? "Hide API key" : "Reveal API key"
                          }
                          className="inline-flex items-center justify-center h-11 w-11 shrink-0 rounded-[var(--radius-md)] border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {showKeys[p.id] ? (
                            <IconEyeOff className="h-4 w-4" />
                          ) : (
                            <IconEye className="h-4 w-4" />
                          )}
                        </button>
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
              </PageTabsContent>
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
              API keys are stored locally in your browser and never sent to our
              servers.
            </p>
          </div>
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
