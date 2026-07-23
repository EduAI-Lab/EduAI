import { useCallback, useEffect, useState } from "react";
import { IconLink, IconLoader, IconTrash } from "@tabler/icons-react";

import {
  connectCanvas,
  disconnectCanvas,
  getCanvasIntegration,
  type CanvasIntegrationPublic,
} from "~/lib/canvas/client";
import { Badge } from "@eduai/ui";
import { Button } from "@eduai/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@eduai/ui";
import { Checkbox } from "@eduai/ui";
import { Input } from "@eduai/ui";
import { Label } from "@eduai/ui";

const PRODUCTION_CANVAS_URL = "https://canvas.ubc.ca";
const LOCAL_CANVAS_URL = "http://localhost:8080";

function defaultCanvasUrl(): string {
  return import.meta.env.DEV ? LOCAL_CANVAS_URL : PRODUCTION_CANVAS_URL;
}

export function CanvasIntegrationSettings() {
  const [integration, setIntegration] = useState<CanvasIntegrationPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [canvasUrl, setCanvasUrl] = useState(defaultCanvasUrl);
  const [apiKey, setApiKey] = useState("");
  const [isTestMode, setIsTestMode] = useState(false);

  const loadIntegration = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCanvasIntegration();
      setIntegration(data);
      if (data?.canvasUrl) {
        setCanvasUrl(data.canvasUrl);
      }
    } catch {
      setError("Could not load Canvas integration. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIntegration();
  }, [loadIntegration]);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await connectCanvas({
        canvasUrl: canvasUrl.trim(),
        apiKey: isTestMode ? undefined : apiKey.trim(),
        isTestMode,
      });
      setIntegration(data);
      setApiKey("");
      setSuccess(
        data.isTestMode
          ? "Canvas test mode enabled."
          : "Canvas connected. Your API key is stored encrypted and is not shown again.",
      );
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : "Could not connect to Canvas. Please try again.",
      );
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    setSuccess(null);
    try {
      await disconnectCanvas();
      setIntegration(null);
      setApiKey("");
      setSuccess("Canvas disconnected.");
    } catch {
      setError("Could not disconnect Canvas. Please try again.");
    } finally {
      setDisconnecting(false);
    }
  };

  const canConnect =
    canvasUrl.trim().length > 0 && (isTestMode || apiKey.trim().length > 0) && !connecting;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconLink className="h-5 w-5" />
          Canvas Integration
        </CardTitle>
        <CardDescription>
          Connect your Canvas personal access token so EduAI can sync courses and rosters. The token
          is encrypted on the server and never returned to the browser after saving.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <IconLoader className="h-4 w-4 animate-spin" />
            Loading Canvas status…
          </div>
        ) : (
          <>
            {integration && (
              <div className="p-3 border rounded-md flex items-center justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">Connected</Badge>
                    {integration.isTestMode && <Badge variant="outline">Test mode</Badge>}
                  </div>
                  <p className="text-sm font-mono break-all">{integration.canvasUrl}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleDisconnect()}
                  disabled={disconnecting}
                  className="text-red-600 hover:text-red-700 shrink-0"
                  aria-label="Disconnect Canvas"
                >
                  {disconnecting ? (
                    <IconLoader className="h-4 w-4 animate-spin" />
                  ) : (
                    <IconTrash className="h-4 w-4" />
                  )}
                </Button>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="canvas-url">Canvas instance URL</Label>
              <Input
                id="canvas-url"
                placeholder="https://canvas.ubc.ca"
                value={canvasUrl}
                onChange={(e) => setCanvasUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Site root only — no trailing slash or <span className="font-mono">/api/v1</span>.
                Local dev: <span className="font-mono">http://localhost:8080</span>
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="canvas-api-key">Personal access token</Label>
              <Input
                id="canvas-api-key"
                type="password"
                placeholder={integration ? "Enter a new token to update" : "Paste Canvas API token"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={isTestMode}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Create under Canvas → Settings → Approved Integrations → New Access Token.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="canvas-test-mode"
                checked={isTestMode}
                onCheckedChange={(checked) => setIsTestMode(checked === true)}
              />
              <Label htmlFor="canvas-test-mode" className="font-normal cursor-pointer">
                Test mode (no real Canvas token required)
              </Label>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && <p className="text-sm text-green-700 dark:text-green-400">{success}</p>}

            <Button onClick={() => void handleConnect()} disabled={!canConnect}>
              {connecting ? (
                <>
                  <IconLoader className="h-4 w-4 mr-2 animate-spin" />
                  Connecting…
                </>
              ) : integration ? (
                "Update connection"
              ) : (
                "Connect Canvas"
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
