import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Key, Eye, EyeOff, ExternalLink, Shield, Trash2 } from "lucide-react";
import { useApiKeys } from "~/hooks/use-api-keys";

interface ApiKeySettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ApiKeySettings({ open, onOpenChange }: ApiKeySettingsProps) {
  const { apiKeys, updateProviderSettings, removeProviderSettings, isProviderConfigured } = useApiKeys();
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [tempKeys, setTempKeys] = useState<Record<string, string>>({});

  const handleSaveKey = (provider: 'openai' | 'google') => {
    const key = tempKeys[provider]?.trim();
    if (key) {
      updateProviderSettings(provider, {
        apiKey: key,
        isEnabled: true
      });
      setTempKeys(prev => ({ ...prev, [provider]: '' }));
    }
  };

  const handleRemoveKey = (provider: 'openai' | 'google') => {
    removeProviderSettings(provider);
    setTempKeys(prev => ({ ...prev, [provider]: '' }));
  };

  const toggleShowKey = (provider: string) => {
    setShowKeys(prev => ({ ...prev, [provider]: !prev[provider] }));
  };

const maskKey = (key: string) => {
    if (!key) return '';
   if (key.length <= 8) {
     return key.substring(0, 2) + '•'.repeat(Math.max(4, key.length - 2));
   }
   return key.substring(0, 8) + '•'.repeat(Math.max(0, key.length - 8));
  };

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
          {/* OpenAI API Key */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-medium">OpenAI API Key</CardTitle>
                  <CardDescription className="text-xs">
                    For GPT models and other OpenAI services
                  </CardDescription>
                </div>
                {isProviderConfigured('openai') && (
                  <Badge variant="secondary" className="text-xs">
                    <Shield className="h-3 w-3 mr-1" />
                    Active
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {isProviderConfigured('openai') ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      type={showKeys.openai ? "text" : "password"}
                      value={showKeys.openai ? apiKeys.openai?.apiKey || '' : maskKey(apiKeys.openai?.apiKey || '')}
                      readOnly
                      className="text-sm"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => toggleShowKey('openai')}
                      className="px-3"
                    >
                      {showKeys.openai ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleRemoveKey('openai')}
                      className="px-3 text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    type="password"
                    placeholder="sk-..."
                    value={tempKeys.openai || ''}
                    onChange={(e) => setTempKeys(prev => ({ ...prev, openai: e.target.value }))}
                    className="text-sm"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleSaveKey('openai')}
                    disabled={!tempKeys.openai?.trim()}
                    className="w-full"
                  >
                    Save OpenAI Key
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Get your API key from{" "}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  OpenAI Platform
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </CardContent>
          </Card>

          {/* Google API Key */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-medium">Google AI API Key</CardTitle>
                  <CardDescription className="text-xs">
                    For Gemini models and Google AI services
                  </CardDescription>
                </div>
                {isProviderConfigured('google') && (
                  <Badge variant="secondary" className="text-xs">
                    <Shield className="h-3 w-3 mr-1" />
                    Active
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {isProviderConfigured('google') ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      type={showKeys.google ? "text" : "password"}
                      value={showKeys.google ? apiKeys.google?.apiKey || '' : maskKey(apiKeys.google?.apiKey || '')}
                      readOnly
                      className="text-sm"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => toggleShowKey('google')}
                      className="px-3"
                    >
                      {showKeys.google ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleRemoveKey('google')}
                      className="px-3 text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    type="password"
                    placeholder="AIza..."
                    value={tempKeys.google || ''}
                    onChange={(e) => setTempKeys(prev => ({ ...prev, google: e.target.value }))}
                    className="text-sm"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleSaveKey('google')}
                    disabled={!tempKeys.google?.trim()}
                    className="w-full"
                  >
                    Save Google Key
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Get your API key from{" "}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  Google AI Studio
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </CardContent>
          </Card>

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