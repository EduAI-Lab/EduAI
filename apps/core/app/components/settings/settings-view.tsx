import { Form } from "react-router";
import { useState } from "react";

import { CanvasIntegrationSettings } from "~/components/canvas/canvas-integration-settings";
import {
  IconAccessible,
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
import { usePolicies } from "~/hooks/api/use-policies";

const CANVAS_SETTINGS_ROLES = new Set(["INSTRUCTOR", "ADMIN"]);

interface SettingsViewProps {
  role?: string;
  studentNumber?: string | null;
}

export function SettingsView({ role, studentNumber = null }: SettingsViewProps) {
  const { policies } = usePolicies();
  // Instructors only see Canvas settings when the policy is on; ADMIN is
  // unaffected. Mirrors the `instructors.canManageCanvasIntegration` gate on
  // the Canvas API (canvas.$.ts).
  const canvasPolicyOk =
    role === "ADMIN" ||
    (policies["instructors.canManageCanvasIntegration"] ?? true);
  const showCanvasSettings = CANVAS_SETTINGS_ROLES.has(role ?? "") && canvasPolicyOk;
  const showStudentNumberSettings = role === "STUDENT";
  const {
    updateProviderSettings,
    removeProviderSettings,
    isProviderConfigured,
  } = useApiKeys();
  const [activeTab, setActiveTab] = useState("accessibility");

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div className="px-4 lg:px-6">
            <PageHeading
              heading="Settings"
              subheading="Manage account preferences and local model provider configuration."
            />
          </div>
          <div className="px-4 lg:px-6">
            <PageTabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <PageTabsList>
          <PageTabsTrigger value="accessibility">
            <IconAccessible className="h-4 w-4" /> Accessibility
          </PageTabsTrigger>
          <PageTabsTrigger value="providers">
            <IconWorld className="h-4 w-4" /> Providers
          </PageTabsTrigger>
        </PageTabsList>

        <PageTabsContent value="accessibility">
          <AccessibilitySettingsTab />
          {showStudentNumberSettings && (
            <StudentNumberSettings initialStudentNumber={studentNumber} />
          )}
        </PageTabsContent>

        <PageTabsContent value="providers">
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
