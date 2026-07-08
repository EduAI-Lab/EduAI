import { Form, useFetcher } from "react-router";
import { useState } from "react";

import { CanvasIntegrationSettings } from "~/components/canvas/canvas-integration-settings";
import {
  IconAccessible,
  IconAlertTriangle,
  IconLink,
  IconUser,
  IconWorld,
} from "@tabler/icons-react";
import { AccessibilitySettingsTab } from "~/components/settings/accessibility-settings-tab";
import { ChangePasswordSettings } from "~/components/settings/change-password-settings";
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
import { ScrollReveal } from "~/components/motion/scroll-reveal";
import { useApiKeys } from "~/hooks/use-api-keys";
import {
  DisabledTooltip,
  usePolicyGate,
} from "~/components/policy/policy-gate";

const CANVAS_SETTINGS_ROLES = new Set(["INSTRUCTOR", "ADMIN"]);

interface SettingsViewProps {
  role?: string;
  studentNumber?: string | null;
  passwordExpired?: boolean;
  providerExpiries?: Record<string, string>;
}

export function SettingsView({
  role,
  studentNumber = null,
  passwordExpired = false,
  providerExpiries = {},
}: SettingsViewProps) {
  const { isEnabled } = usePolicyGate();
  const roleHasCanvas = CANVAS_SETTINGS_ROLES.has(role ?? "");
  const canvasEnabled =
    role === "ADMIN" || isEnabled("instructors.canManageCanvasIntegration");
  const showCanvasSettings = roleHasCanvas && canvasEnabled;
  const showStudentNumberSettings = role === "STUDENT";
  const {
    updateProviderSettings,
    removeProviderSettings,
    isProviderConfigured,
  } = useApiKeys();
  const [activeTab, setActiveTab] = useState("account");

  // Local state for expiry date inputs, seeded from loader data.
  const [localExpiries, setLocalExpiries] = useState<Record<string, string>>(providerExpiries);

  const expiryFetcher = useFetcher();

  function handleExpiryChange(providerName: string, value: string) {
    setLocalExpiries((prev) => ({ ...prev, [providerName]: value }));
    expiryFetcher.submit(
      { _action: "setExpiry", providerName, apiKeyExpiresAt: value },
      { method: "post", action: "/settings" },
    );
  }

  function handleRemoveProvider(providerName: string) {
    removeProviderSettings(providerName);
    expiryFetcher.submit(
      { _action: "setExpiry", providerName, apiKeyExpiresAt: "" },
      { method: "post", action: "/settings" },
    );
    setLocalExpiries((prev) => {
      const next = { ...prev };
      delete next[providerName];
      return next;
    });
  }

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div className="px-4 lg:px-6">
            <PageHeading
              heading="Settings"
              subheading="Manage your account, accessibility preferences, and model provider configuration."
            />
          </div>

          {passwordExpired && (
            <div className="px-4 lg:px-6">
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <IconAlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                <div className="text-sm">
                  <p className="font-medium">Your password has expired</p>
                  <p className="mt-0.5 text-amber-800 dark:text-amber-300">
                    UBC policy requires passwords to be changed annually. Please
                    update your password below before continuing.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="px-4 lg:px-6">
            <PageTabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <PageTabsList>
                <PageTabsTrigger value="account">
                  <IconUser className="h-4 w-4" /> Account
                </PageTabsTrigger>
                <PageTabsTrigger value="accessibility">
                  <IconAccessible className="h-4 w-4" /> Accessibility
                </PageTabsTrigger>
                <PageTabsTrigger value="providers">
                  <IconWorld className="h-4 w-4" /> Providers
                </PageTabsTrigger>
                {roleHasCanvas && (
                  <DisabledTooltip disabled={!canvasEnabled}>
                    <PageTabsTrigger value="canvas">
                      <IconLink className="h-4 w-4" /> Canvas
                    </PageTabsTrigger>
                  </DisabledTooltip>
                )}
              </PageTabsList>

              <PageTabsContent value="account" className="space-y-6">
                <ScrollReveal index={0} parallax={false}>
                  <ChangePasswordSettings />
                  {showStudentNumberSettings && (
                    <StudentNumberSettings initialStudentNumber={studentNumber} />
                  )}
                </ScrollReveal>
              </PageTabsContent>

              <PageTabsContent value="accessibility">
                <ScrollReveal index={0} parallax={false}>
                  <AccessibilitySettingsTab />
                </ScrollReveal>
              </PageTabsContent>

              {showCanvasSettings && (
                <PageTabsContent value="canvas">
                  <ScrollReveal index={0} parallax={false}>
                    <CanvasIntegrationSettings />
                  </ScrollReveal>
                </PageTabsContent>
              )}

              <PageTabsContent value="providers" className="space-y-6">
                <ScrollReveal index={0} parallax={false}>
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
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">Configured</Badge>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRemoveProvider("openai")}
                              className="text-red-600 hover:text-red-700"
                            >
                              Remove
                            </Button>
                          </div>
                          <div className="flex items-center gap-2">
                            <Label className="text-sm text-muted-foreground shrink-0 w-16">
                              Expires
                            </Label>
                            <Input
                              type="date"
                              className="w-44"
                              min={today}
                              value={localExpiries["openai"] ?? ""}
                              onChange={(e) => handleExpiryChange("openai", e.target.value)}
                              aria-label="OpenAI key expiry date"
                            />
                            {localExpiries["openai"] && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleExpiryChange("openai", "")}
                                className="text-muted-foreground"
                              >
                                Clear
                              </Button>
                            )}
                          </div>
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
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">Configured</Badge>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRemoveProvider("google")}
                              className="text-red-600 hover:text-red-700"
                            >
                              Remove
                            </Button>
                          </div>
                          <div className="flex items-center gap-2">
                            <Label className="text-sm text-muted-foreground shrink-0 w-16">
                              Expires
                            </Label>
                            <Input
                              type="date"
                              className="w-44"
                              min={today}
                              value={localExpiries["google"] ?? ""}
                              onChange={(e) => handleExpiryChange("google", e.target.value)}
                              aria-label="Google AI key expiry date"
                            />
                            {localExpiries["google"] && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleExpiryChange("google", "")}
                                className="text-muted-foreground"
                              >
                                Clear
                              </Button>
                            )}
                          </div>
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
                </ScrollReveal>
              </PageTabsContent>
            </PageTabs>
          </div>

          <div className="px-4 lg:px-6">
            <ScrollReveal index={1} parallax={false}>
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
            </ScrollReveal>
          </div>
        </div>
      </div>
    </div>
  );
}
