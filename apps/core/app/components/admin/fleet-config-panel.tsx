import { useEffect, useState } from "react";
import { IconPlus, IconTrash } from "@tabler/icons-react";

import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
} from "@eduai/ui";
import type { FleetJobType, FleetServerConfig } from "~/hooks/api/use-fleet-config";

type FleetConfigPanelProps = {
  servers: FleetServerConfig[];
  configured: boolean;
  source: "file" | "environment";
  loading: boolean;
  saving: boolean;
  error: string | null;
  onSave: (servers: FleetServerConfig[]) => Promise<FleetServerConfig[]>;
};

const emptyServer = (): FleetServerConfig => ({
  id: "",
  baseUrl: "",
  jobTypes: ["interactive"],
  models: [],
});

function validateServers(servers: FleetServerConfig[]): string | null {
  const ids = new Set<string>();
  for (const [index, server] of servers.entries()) {
    if (!server.id.trim()) return `Server ${index + 1}: an ID is required.`;
    if (ids.has(server.id.trim())) return `Server ${index + 1}: IDs must be unique.`;
    ids.add(server.id.trim());
    if (!server.baseUrl.trim()) return `Server ${index + 1}: a base URL is required.`;
    if (!URL.canParse(server.baseUrl.trim())) {
      return `Server ${index + 1}: enter a valid base URL.`;
    }
    if (server.jobTypes.length === 0) {
      return `Server ${index + 1}: select at least one workload type.`;
    }
  }
  return null;
}

export function FleetConfigPanel({
  servers,
  configured,
  source,
  loading,
  saving,
  error,
  onSave,
}: FleetConfigPanelProps) {
  const [drafts, setDrafts] = useState<FleetServerConfig[]>(servers);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDrafts(servers);
  }, [servers]);

  const updateServer = (index: number, patch: Partial<FleetServerConfig>) => {
    setSaved(false);
    setValidationError(null);
    setDrafts((current) =>
      current.map((server, currentIndex) =>
        currentIndex === index ? { ...server, ...patch } : server,
      ),
    );
  };

  const toggleJobType = (index: number, jobType: FleetJobType, checked: boolean) => {
    const server = drafts[index];
    if (!server) return;
    const jobTypes = checked
      ? [...new Set([...server.jobTypes, jobType])]
      : server.jobTypes.filter((current) => current !== jobType);
    updateServer(index, { jobTypes });
  };

  const handleSave = async () => {
    const normalized = drafts.map((server) => ({
      ...server,
      id: server.id.trim(),
      baseUrl: server.baseUrl.trim().replace(/\/$/, ""),
      models: server.models.map((model) => model.trim()).filter(Boolean),
    }));
    const validation = validateServers(normalized);
    if (validation) {
      setValidationError(validation);
      return;
    }
    setValidationError(null);
    setSaved(false);
    try {
      await onSave(normalized);
      setSaved(true);
    } catch {
      // The hook exposes the server error in the panel; keep the editor open.
      setSaved(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI fleet configuration</CardTitle>
        <CardDescription>
          Manage the vLLM fleet used by Auto routing. Live <code>/v1/models</code> health checks are
          the source of truth; fallback models are used only when a server cannot be reached.
        </CardDescription>
        <p className="text-sm text-muted-foreground">
          {configured
            ? "fleet.config.json is active for this deployment."
            : source === "environment"
              ? "The deployment is currently using environment settings. Saving creates a fleet.config.json for this deployment."
              : "fleet.config.json is active for this deployment."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading fleet configuration…</p>
        ) : (
          <>
            {(error || validationError) && (
              <Alert variant="destructive">
                <AlertDescription>{validationError ?? error}</AlertDescription>
              </Alert>
            )}
            {saved && (
              <Alert>
                <AlertDescription>
                  Fleet configuration saved and routing caches refreshed.
                </AlertDescription>
              </Alert>
            )}

            {drafts.length === 0 && (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                No fleet servers are configured. Add a server to enable fleet routing.
              </p>
            )}

            <div className="space-y-3">
              {drafts.map((server, index) => (
                <div key={`${index}-${server.id}`} className="rounded-lg border p-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-1 text-sm font-medium">
                      Server ID
                      <Input
                        aria-label={`Server ${index + 1} ID`}
                        value={server.id}
                        onChange={(event) => updateServer(index, { id: event.target.value })}
                        placeholder="cmps01"
                      />
                    </label>
                    <label className="space-y-1 text-sm font-medium">
                      Base URL
                      <Input
                        aria-label={`Server ${index + 1} base URL`}
                        value={server.baseUrl}
                        onChange={(event) => updateServer(index, { baseUrl: event.target.value })}
                        placeholder="http://cmps01.ok.ubc.ca:8001"
                      />
                    </label>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-5">
                    <span className="text-sm font-medium">Workloads</span>
                    {(["interactive", "background"] as const).map((jobType) => (
                      <label key={jobType} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={server.jobTypes.includes(jobType)}
                          onCheckedChange={(checked) =>
                            toggleJobType(index, jobType, checked === true)
                          }
                          aria-label={`${jobType} workload for server ${index + 1}`}
                        />
                        {jobType === "interactive" ? "Interactive chat" : "Background jobs"}
                      </label>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      className="ml-auto text-destructive"
                      onClick={() => {
                        setSaved(false);
                        setDrafts((current) =>
                          current.filter((_, currentIndex) => currentIndex !== index),
                        );
                      }}
                    >
                      <IconTrash className="mr-2 h-4 w-4" />
                      Remove
                    </Button>
                  </div>

                  <label className="mt-4 block space-y-1 text-sm font-medium">
                    Fallback models (optional)
                    <Input
                      aria-label={`Fallback models for server ${index + 1}`}
                      value={server.models.join(", ")}
                      onChange={(event) =>
                        updateServer(index, {
                          models: event.target.value.split(",").map((model) => model.trim()),
                        })
                      }
                      placeholder="qwen2.5-7b-instruct, qwen2.5-32b-instruct"
                    />
                    <span className="block text-xs font-normal text-muted-foreground">
                      Comma-separated model IDs used only if the live model check fails.
                    </span>
                  </label>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSaved(false);
                  setDrafts((current) => [...current, emptyServer()]);
                }}
                disabled={saving}
              >
                <IconPlus className="mr-2 h-4 w-4" />
                Add server
              </Button>
              <Button type="button" onClick={() => void handleSave()} disabled={saving}>
                {saving ? "Saving…" : "Save fleet config"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
