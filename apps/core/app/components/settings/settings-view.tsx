import { Form } from "react-router";
import { useEffect, useState } from "react";

import { CanvasIntegrationSettings } from "~/components/canvas/canvas-integration-settings";
import { AccessibilitySettingsTab } from "~/components/settings/accessibility-settings-tab";
import { StudentNumberSettings } from "~/components/settings/student-number-settings";
import {
  Accessibility,
  CheckCircle2,
  Copy,
  Globe,
  Key,
  Plus,
  Shield,
  Trash2,
} from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useApiKeys } from "~/hooks/use-api-keys";
import { authClient } from "~/lib/auth/client";

type ServerApiKey = {
  id: string;
  name?: string | null;
  start?: string | null;
  prefix?: string | null;
  enabled: boolean;
  expiresAt?: Date | string | null;
};

const FIXED_PREFIX = "eduai";
const CANVAS_SETTINGS_ROLES = new Set(["INSTRUCTOR", "ADMIN"]);

interface SettingsViewProps {
  role?: string;
  studentNumber?: string | null;
}

export function SettingsView({ role, studentNumber = null }: SettingsViewProps) {
  const showCanvasSettings = CANVAS_SETTINGS_ROLES.has(role ?? "");
  const showStudentNumberSettings = role === "STUDENT";
  const {
    updateProviderSettings,
    removeProviderSettings,
    isProviderConfigured,
  } = useApiKeys();
  const [activeTab, setActiveTab] = useState("accessibility");
  const [serverKeys, setServerKeys] = useState<ServerApiKey[]>([]);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKeyPlain, setCreatedKeyPlain] = useState<string | null>(null);
  const [copyOk, setCopyOk] = useState(false);

  const loadServerKeys = async () => {
    try {
      const res = await authClient.apiKey.list();
      if (res.error) throw new Error(res.error.message);
      setServerKeys(res.data || []);
    } catch (e) {
      console.error("Failed to list API keys", e);
    }
  };

  useEffect(() => {
    void loadServerKeys();
  }, []);

  const createServerKey = async () => {
    try {
      setCreating(true);
      setCreatedKeyPlain(null);
      const { data, error } = await authClient.apiKey.create({
        name: newKeyName || undefined,
        prefix: FIXED_PREFIX,
        expiresIn: 60 * 60 * 24 * 30,
      });
      if (error) throw new Error(error.message);
      if (data?.key) {
        setCreatedKeyPlain(data.key);
      }
      await loadServerKeys();
      setNewKeyName("");
    } catch (e) {
      console.error("Failed to create key", e);
    } finally {
      setCreating(false);
    }
  };

  const deleteServerKey = async (keyId: string) => {
    try {
      await authClient.apiKey.delete({ keyId });
      await loadServerKeys();
    } catch (e) {
      console.error("Failed to delete key", e);
    }
  };

  const copyCreatedKey = async () => {
    if (!createdKeyPlain) return;
    try {
      await navigator.clipboard.writeText(createdKeyPlain);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 1500);
    } catch {
      // clipboard unavailable in test env
    }
  };

  return (
    <div className="px-4 py-6 max-w-4xl mx-auto w-full">
      <h1 className="text-2xl font-bold mb-2">Settings</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Manage account preferences, API keys, and local model provider configuration.
      </p>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="settings-tabs">
          <TabsTrigger value="accessibility">
            <Accessibility className="h-4 w-4" /> Accessibility
          </TabsTrigger>
          <TabsTrigger value="api-keys">
            <Key className="h-4 w-4" /> API Keys
          </TabsTrigger>
          <TabsTrigger value="providers">
            <Globe className="h-4 w-4" /> Providers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="accessibility">
          <AccessibilitySettingsTab />
        </TabsContent>

        <TabsContent value="api-keys" className="mt-6 space-y-6">
          {showStudentNumberSettings && (
            <StudentNumberSettings initialStudentNumber={studentNumber} />
          )}

          <Card>
            <CardHeader>
              <CardTitle>Server API Keys</CardTitle>
              <CardDescription>
                Create and manage API keys used to call EduAI endpoints. Keys
                are verified via Better Auth.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="key-name" className="mb-1">
                  Name
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="key-name"
                    placeholder="My Integration"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    className="flex-1"
                  />
                  <Button onClick={createServerKey} disabled={creating}>
                    <Plus className="h-4 w-4 mr-1" /> Create
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Keys are created with prefix{" "}
                  <span className="font-mono">{FIXED_PREFIX}-</span> followed by
                  a random string.
                </p>
              </div>

              {createdKeyPlain && (
                <div className="p-3 border rounded-md bg-muted/30 flex items-center justify-between">
                  <div className="text-sm">
                    <span className="font-medium">
                      Copy and store your new key now:
                    </span>
                    <div className="mt-1 font-mono break-all">
                      {createdKeyPlain}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={copyCreatedKey}>
                    {copyOk ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              )}

              <div className="space-y-2">
                {serverKeys.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No API keys yet.
                  </p>
                ) : (
                  serverKeys.map((k) => (
                    <div
                      key={k.id}
                      className="p-3 border rounded-md flex items-center justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {k.name || "Unnamed Key"}
                          </span>
                          {k.enabled ? (
                            <Badge variant="secondary">
                              <Shield className="h-3 w-3 mr-1" /> Active
                            </Badge>
                          ) : (
                            <Badge variant="outline">Disabled</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono break-all">
                          {k.prefix}-
                          {k.start ? `${k.start.substring(0, 8)}...` : "******"}
                        </div>
                        {k.expiresAt && (
                          <div className="text-xs text-muted-foreground">
                            Expires:{" "}
                            {new Date(k.expiresAt).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => deleteServerKey(k.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {showCanvasSettings && <CanvasIntegrationSettings />}

          <Card>
            <CardHeader>
              <CardTitle>How to use API Keys</CardTitle>
              <CardDescription>
                Send your key in the <span className="font-mono">x-api-key</span> header when calling{" "}
                <span className="font-mono">/api/*</span> endpoints. Note: x-api-key usage is restricted
                to ADMIN users across /api/*; students should use the web UI.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="text-xs bg-muted p-3 rounded-md overflow-auto whitespace-pre-wrap break-words">{`curl -N -X POST "http://localhost:5173/api/chat" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_API_KEY" \\
  -d '{"messages":[{"role":"user","content":"hello"}],"model":"google:gemini-2.0-flash","apiKeys":{"google":{"apiKey":"AIza-***","isEnabled":true}}}'`}</pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="providers" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Model Providers</CardTitle>
              <CardDescription>
                Local, browser-stored settings used when calling models.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label className="mb-1">OpenAI</Label>
                {isProviderConfigured("openai") ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">Configured</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => removeProviderSettings("openai")}
                      className="text-red-600 hover:text-red-700"
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <Input
                    placeholder="sk-..."
                    onChange={(e) =>
                      updateProviderSettings("openai", {
                        apiKey: e.target.value,
                        isEnabled: true,
                      })
                    }
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label className="mb-1">Google AI (Gemini)</Label>
                {isProviderConfigured("google") ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">Configured</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => removeProviderSettings("google")}
                      className="text-red-600 hover:text-red-700"
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <Input
                    placeholder="AIza-..."
                    onChange={(e) =>
                      updateProviderSettings("google", {
                        apiKey: e.target.value,
                        isEnabled: true,
                      })
                    }
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label className="mb-1">Ollama (Local)</Label>
                {isProviderConfigured("ollama") ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">Enabled</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => removeProviderSettings("ollama")}
                      className="text-red-600 hover:text-red-700"
                    >
                      Disable
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    onClick={() =>
                      updateProviderSettings("ollama", { isEnabled: true })
                    }
                  >
                    Enable Ollama
                  </Button>
                )}
              </div>

              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">
                  Local inference managed on the server via{" "}
                  <code className="text-xs">OLLAMA_BASE_URL</code> and{" "}
                  <code className="text-xs">VLLM_BASE_URL</code> in{" "}
                  <code className="text-xs">apps/core/.env</code>. No browser
                  toggle — pick <code className="text-xs">ollama:</code> or{" "}
                  <code className="text-xs">vllm:</code> models in chat when
                  configured.
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  See repo docs:{" "}
                  <code className="text-xs">docs/rag-ai/VLLM.md</code>,{" "}
                  <code className="text-xs">
                    docs/rag-ai/HOW_TO_USE_DEV_SERVER.md
                  </code>
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Sign out of EduAI on this browser.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" action="/auth/logout" replace>
            <Button type="submit" variant="outline">
              Log out
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
