/**
 * Canvas tab for the course workspace. Surfaces what used to be buried inside
 * dialogs: connection status and the import entry point. Connecting an account
 * lives in Settings; exporting lives on a built assessment — this tab orients
 * the user and launches the import wizard. The tab itself only renders for a
 * course synced from Canvas, so it does not restate that link.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Badge, Button, PanelCard, EmptyState } from "@eduai/ui";
import {
  IconSchool,
  IconDownload,
  IconUpload,
  IconPlugConnected,
  IconExternalLink,
} from "@tabler/icons-react";
import { canvasService, type CanvasIntegration } from "@/services/canvasService";

interface CourseCanvasTabProps {
  courseId: number;
  canWrite: boolean;
  onImportFromCanvas: () => void;
}

export function CourseCanvasTab({ courseId, canWrite, onImportFromCanvas }: CourseCanvasTabProps) {
  const [integration, setIntegration] = useState<CanvasIntegration | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    canvasService
      .getIntegration()
      .then((intg) => {
        if (!cancelled) setIntegration(intg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-36 animate-pulse rounded-[var(--radius-xl)] border border-border bg-card" />
        <div className="h-36 animate-pulse rounded-[var(--radius-xl)] border border-border bg-card" />
      </div>
    );
  }

  if (!integration?.isConnected) {
    return (
      <EmptyState
        icon={<IconSchool className="size-6" />}
        title="Canvas isn't connected"
        description="Connect your Canvas account to import quizzes as assessments and export assessments back to Canvas."
        bare={false}
        action={
          <Button asChild>
            <a href="/settings">
              <IconPlugConnected className="size-4" />
              Connect Canvas in Settings
            </a>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PanelCard
        title="Connection"
        action={
          integration.isTestMode ? (
            <Badge variant="warning">Test mode</Badge>
          ) : (
            <Badge variant="success">Connected</Badge>
          )
        }
      >
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-muted text-muted-foreground">
            <IconSchool className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">
              {integration.canvasUrl || "Canvas"}
            </div>
            <Link to="/settings" className="text-xs font-medium text-primary-text hover:underline">
              Manage connection
            </Link>
          </div>
        </div>
      </PanelCard>

      <PanelCard title="Move questions in and out of Canvas">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-primary/10 text-primary-text">
              <IconDownload className="size-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">Import a quiz</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Pull a Canvas quiz in as a new assessment with its questions.
              </div>
            </div>
          </div>
          <Button onClick={onImportFromCanvas} disabled={!canWrite} className="shrink-0">
            <IconDownload className="size-4" />
            Import from Canvas
          </Button>
        </div>

        <div className="mt-4 flex items-start gap-3 border-t border-border pt-4 text-sm text-muted-foreground">
          <IconUpload className="mt-0.5 size-4 shrink-0" />
          <p>
            To export, open an assessment on the{" "}
            <span className="font-medium text-foreground">Assessments</span> tab and choose{" "}
            <span className="font-medium text-foreground">Export to Canvas</span>.
            <IconExternalLink className="ml-1 inline size-3.5 align-text-bottom opacity-60" />
          </p>
        </div>
      </PanelCard>
    </div>
  );
}
