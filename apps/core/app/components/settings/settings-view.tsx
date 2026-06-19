import { Form } from "react-router";
import { useState } from "react";

import { CanvasIntegrationSettings } from "~/components/canvas/canvas-integration-settings";
import { AccessibilitySettingsTab } from "~/components/settings/accessibility-settings-tab";
import { StudentNumberSettings } from "~/components/settings/student-number-settings";
import {
  Accessibility,
  Globe,
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

  return (
    <div className="px-4 py-6 max-w-4xl mx-auto w-full">
      <h1 className="text-2xl font-bold mb-2">Settings</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Manage account preferences and local model provider configuration.
      </p>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="settings-tabs">
          <TabsTrigger value="accessibility">
            <Accessibility className="h-4 w-4" /> Accessibility
          </TabsTrigger>
          <TabsTrigger value="providers">
            <Globe className="h-4 w-4" /> Providers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="accessibility" className="mt-6 space-y-6">
          <AccessibilitySettingsTab />
          {showStudentNumberSettings && (
            <StudentNumberSettings initialStudentNumber={studentNumber} />
          )}
        </TabsContent>

        <TabsContent value="providers" className="mt-6 space-y-6">
          {showCanvasSettings && <CanvasIntegrationSettings />}
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
