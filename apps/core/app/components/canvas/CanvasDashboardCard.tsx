import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { IconLoader, IconRefresh } from "@tabler/icons-react";

import { CanvasCourseSyncDialog } from "~/components/canvas/CanvasCourseSyncDialog";
import { Button } from "@eduai/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@eduai/ui";
import { getCanvasIntegration, type CanvasIntegrationPublic } from "~/lib/canvas/client";

export function CanvasDashboardCard() {
  const [integration, setIntegration] = useState<CanvasIntegrationPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);

  const loadIntegration = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCanvasIntegration();
      setIntegration(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Canvas status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIntegration();
  }, [loadIntegration]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Canvas course sync</CardTitle>
          <CardDescription>
            Sync your Canvas courses and rosters into EduAI. Connect your Canvas token in Settings
            first, then choose which courses to sync here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <IconLoader className="h-4 w-4 animate-spin" />
              Checking Canvas connection…
            </div>
          ) : integration ? (
            <>
              <p className="text-sm text-muted-foreground">
                Connected to <span className="font-mono">{integration.canvasUrl}</span>
                {integration.isTestMode ? " (test mode)" : ""}.
              </p>
              <Button type="button" onClick={() => setSyncDialogOpen(true)}>
                <IconRefresh className="mr-2 h-4 w-4" />
                Sync to Canvas
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Canvas is not connected yet. Add your personal access token in Settings before
                syncing courses.
              </p>
              <Button asChild variant="outline">
                <Link to="/settings">Connect Canvas in Settings</Link>
              </Button>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <CanvasCourseSyncDialog open={syncDialogOpen} onOpenChange={setSyncDialogOpen} />
    </>
  );
}
