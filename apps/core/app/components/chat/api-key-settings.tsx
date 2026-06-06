import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Key, Eye, EyeOff, ExternalLink, Shield, Trash2 } from "lucide-react";
import type { UserProviderSettings } from "~/lib/ai/providers";

type Provider = "openai" | "google";

export interface ApiKeySettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiKeys: UserProviderSettings;
  isProviderConfigured: (provider: Provider) => boolean;
  onUpdateProvider: (provider: Provider, settings: { apiKey?: string; isEnabled: boolean }) => void;
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
      setTempKeys(prev => ({ ...prev, [provider]: "" }));
    }
  };

  const handleRemoveKey = (provider: Provider) => {
    onRemoveProvider(provider);
    setTempKeys(prev => ({ ...prev, [provider]: "" }));
  };

  const toggleShowKey = (provider: string) => {
    setShowKeys(prev => ({ ...prev, [provider]: !prev[provider] }));
  };

  const maskKey = (key: string) => {
    if (!key) return "";
    if (key.length <= 8) return key.substring(0, 2) + "•".repeat(Math.max(4, key.length - 2));
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
      label: "OpenAI API Key",
      description: "For GPT models and other OpenAI services",
      placeholder: "sk-...",
      learnMoreLabel: "OpenAI Platform",
      learnMoreHref: "https://platform.openai.com/api-keys",
    },
    {
      id: "google",
      label: "Google AI API Key",
      description: "For Gemini models and Google AI services",
      placeholder: "AIza...",
      learnMoreLabel: "Google AI Studio",
      learnMoreHref: "https://aistudio.google.com/app/apikey",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            API Key Settings
          </DialogTitle>
          <DialogDescription>
            Configure your own API keys to use your personal quotas and credits.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {providers.map((p) => (
            <Card key={p.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-medium">{p.label}</CardTitle>
                    <CardDescription className="text-xs">{p.description}</CardDescription>
                  </div>
                  {isProviderConfigured(p.id) && (
                    <Badge variant="secondary" className="text-xs">
                      <Shield className="h-3 w-3 mr-1" />
                      Active
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {isProviderConfigured(p.id) ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        type={showKeys[p.id] ? "text" : "password"}
                        value={showKeys[p.id] ? (apiKeys[p.id]?.apiKey || "") : maskKey(apiKeys[p.id]?.apiKey || "")}
                        readOnly
                        className="text-sm"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => toggleShowKey(p.id)}
                        className="px-3"
                      >
                        {showKeys[p.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleRemoveKey(p.id)}
                        className="px-3 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Input
                      type="password"
                      placeholder={p.placeholder}
                      value={tempKeys[p.id] || ""}
                      onChange={(e) => setTempKeys(prev => ({ ...prev, [p.id]: e.target.value }))}
                      className="text-sm"
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleSaveKey(p.id)}
                      disabled={!tempKeys[p.id]?.trim()}
                      className="w-full"
                    >
                      Save {p.label.split(" ")[0]} Key
                    </Button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Get your API key from{" "}
                  <a
                    href={p.learnMoreHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    {p.learnMoreLabel}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              </CardContent>
            </Card>
          ))}

          <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
            <p className="text-sm font-medium">Ollama &amp; vLLM (local)</p>
            <p className="text-xs text-muted-foreground">
              Configured on the server via <code>OLLAMA_BASE_URL</code> and <code>VLLM_BASE_URL</code> — no API key or browser toggle.
              Select <code>ollama:</code> or <code>vllm:</code> models in chat when available.
            </p>
          </div>

          <div className="bg-muted/50 p-3 rounded-lg">
            <p className="text-xs text-muted-foreground">
              <Shield className="h-3 w-3 inline mr-1" />
              API keys are stored locally in your browser and never sent to our servers.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
