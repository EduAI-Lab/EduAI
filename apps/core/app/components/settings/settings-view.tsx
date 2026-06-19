import { Form } from "react-router";
import { useEffect, useState } from "react";

import { CanvasIntegrationSettings } from "~/components/canvas/canvas-integration-settings";
import {
  IconAccessible,
  IconCircleCheck,
  IconCopy,
  IconKey,
  IconPlus,
  IconWorld,
} from "@tabler/icons-react";
import { AccessibilitySettingsTab } from "~/components/settings/accessibility-settings-tab";
import { StudentNumberSettings } from "~/components/settings/student-number-settings";

import { Badge } from "@eduai/ui";
import { Button } from "@eduai/ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@eduai/ui";
import { Input } from "@eduai/ui";
import { Label } from "@eduai/ui";
import { PageTabs, PageTabsList, PageTabsTrigger, PageTabsContent } from "@eduai/ui";
import { PageHeading } from "@eduai/ui";
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
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div className="px-4 lg:px-6">
            <PageHeading
              heading="Settings"
              subheading="Manage account preferences, API keys, and local model provider configuration."
            />
          </div>
          <div className="px-4 lg:px-6">
            <PageTabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <PageTabsList>
          <PageTabsTrigger value="accessibility">
            <IconAccessible className="h-4 w-4" /> Accessibility
          </PageTabsTrigger>
          <PageTabsTrigger value="api-keys">
            <IconKey className="h-4 w-4" /> API Keys
          </PageTabsTrigger>
          <PageTabsTrigger value="providers">
            <IconWorld className="h-4 w-4" /> Providers
          </PageTabsTrigger>
        </PageTabsList>

        <PageTabsContent value="accessibility">
          <AccessibilitySettingsTab />
        </PageTabsContent>

        <PageTabsContent value="api-keys" className="space-y-6">
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
                    <IconPlus className="h-4 w-4 mr-1" /> Create
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
                      <IconCircleCheck className="h-4 w-4" />
                    ) : (
                      <IconCopy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              )}

              <div className="flex flex-col rounded-lg border border-border overflow-hidden">
                {serverKeys.length === 0 ? (
                  <p className="text-sm text-muted-foreground px-5 py-4">
                    No API keys yet.
                  </p>
                ) : (
                  serverKeys.map((k, i) => (
                    <div
                      key={k.id}
                      className="flex items-center gap-3.5 px-5 py-3.5 bg-card border-b border-border last:border-b-0"
                    >
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                        style={{ background: "color-mix(in oklch, var(--primary) 8%, var(--background))" }}
                      >
                        <IconKey className="h-4 w-4" style={{ color: "var(--primary)" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground">
                          {k.name || "Unnamed Key"}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono mt-0.5">
                          {k.prefix}-{k.start ? `${k.start.substring(0, 8)}…` : "••••••••"}
                        </div>
                      </div>
                      {k.expiresAt && (
                        <div className="text-xs text-muted-foreground text-right shrink-0">
                          Expires {new Date(k.expiresAt).toLocaleDateString()}
                        </div>
                      )}
                      {!k.enabled && (
                        <Badge variant="outline" className="shrink-0">Disabled</Badge>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => deleteServerKey(k.id)}
                        className="shrink-0 text-destructive hover:text-destructive border-border"
                      >
                        Revoke
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
        </PageTabsContent>

        <PageTabsContent value="providers">
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
        </PageTabsContent>
            </PageTabs>
          </div>

          <div className="px-4 lg:px-6">
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
        </div>
      </div>
    </div>
  );
}
