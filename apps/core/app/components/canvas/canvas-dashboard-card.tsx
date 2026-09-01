import { useEffect, useState } from "react";
import { Spinner } from "@eduai/ui";
import { Link } from "react-router";
import { IconRefresh } from "@tabler/icons-react";

import { CanvasFetchDialog } from "~/components/canvas/canvas-fetch-dialog";
import { Button } from "@eduai/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@eduai/ui";
import { getCanvasIntegration, type CanvasIntegrationPublic } from "~/lib/canvas/client";
import { DisabledTooltip } from "~/components/policy/policy-gate";

interface CanvasDashboardCardProps {
  /** Render the card greyed-out and non-interactive (e.g. an admin policy turned
   * Canvas off) instead of hiding it — mirrors the Settings Canvas tab (#807). */
  disabled?: boolean;
  /** Integration resolved by the dashboard loader (#1220). When supplied — the
   * value may be `null`, meaning "not connected" — the card renders it directly
   * and never issues the client fetch. Leave `undefined` to keep the legacy
   * mount-then-fetch behaviour. */
  initialIntegration?: CanvasIntegrationPublic | null;
}

export function CanvasDashboardCard({
  disabled = false,
  initialIntegration,
}: CanvasDashboardCardProps) {
  const isServerResolved = initialIntegration !== undefined;
  const [integration, setIntegration] = useState<CanvasIntegrationPublic | null>(
    initialIntegration ?? null,
  );
  const [loading, setLoading] = useState(!isServerResolved);
  const [error, setError] = useState<string | null>(null);
  const [fetchDialogOpen, setFetchDialogOpen] = useState(false);

  useEffect(() => {
    // Loader already resolved it — nothing to fetch (#1220).
    if (isServerResolved) return;
    // Policy-off: the Canvas API 403s ("Forbidden: instructors only"). Skip the
    // fetch so the greyed card doesn't show a spurious error beneath it (#807).
    // `cancelled` also drops late results from a fetch that started while the
    // policy value was still loading (policies default to enabled to avoid
    // flicker), so a stale 403 can't re-appear after the card greys out.
    let cancelled = false;
    if (disabled) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const data = await getCanvasIntegration();
        if (!cancelled) setIntegration(data);
      } catch {
        if (!cancelled) {
          setError("Could not load Canvas status. Please try again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [disabled, isServerResolved]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Canvas courses</CardTitle>
          <CardDescription>
            View courses you have fetched from Canvas into EduAI. Connect your Canvas token in
            Settings first, then fetch courses here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              Checking Canvas connection…
            </div>
          ) : integration ? (
            <>
              <p className="text-sm text-muted-foreground">
                Connected to <span className="font-mono">{integration.canvasUrl}</span>
                {integration.isTestMode ? " (test mode)" : ""}.
              </p>
              <DisabledTooltip disabled={disabled}>
                <Button
                  type="button"
                  onClick={disabled ? undefined : () => setFetchDialogOpen(true)}
                >
                  <IconRefresh className="mr-2 h-4 w-4" />
                  Fetch from Canvas
                </Button>
              </DisabledTooltip>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Canvas is not connected yet. Add your personal access token in Settings before
                fetching courses.
              </p>
              <DisabledTooltip disabled={disabled}>
                <Button asChild variant="outline">
                  <Link to="/settings">Connect Canvas in Settings</Link>
                </Button>
              </DisabledTooltip>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <CanvasFetchDialog open={fetchDialogOpen} onOpenChange={setFetchDialogOpen} />
    </>
  );
}
