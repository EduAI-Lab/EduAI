/**
 * Dialog for exporting an assessment to its linked Canvas course.
 * Validates inputs, triggers export, and surfaces success/error toasts.
 */
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@eduai/ui";
import { Button, Checkbox, Label, Input } from "@eduai/ui";
import { useQmPermissionsForCourse } from "@/hooks/useQmPermissions";
import canvasService from "../../services/canvasService";
import { toast } from "sonner";

interface CanvasExportDialogProps {
  open: boolean;
  onClose: () => void;
  assessmentId: number;
  assessmentName: string;
  courseId?: number | null;
  courseName?: string;
  onExportSuccess?: (result: { quizId: number; canvasUrl: string }) => void;
}

export const CanvasExportDialog = ({
  open,
  onClose,
  assessmentId,
  assessmentName,
  courseId = null,
  courseName,
  onExportSuccess,
}: CanvasExportDialogProps) => {
  const { canManageCanvas } = useQmPermissionsForCourse(courseId);
  const [courseLink, setCourseLink] = useState<Awaited<
    ReturnType<typeof canvasService.getCourseLink>
  > | null>(null);
  // A published quiz is live to students the moment it lands, so require the
  // instructor to opt in rather than making a new export visible by default.
  const [publishInCanvas, setPublishInCanvas] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingCourseLink, setIsLoadingCourseLink] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // Connection form state
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [canvasUrl, setCanvasUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  // Load integration status and courses
  useEffect(() => {
    if (open) {
      // `AssessmentBuilderPage` keeps this dialog mounted between exports, so
      // the publish choice is re-defaulted on every open rather than carrying
      // one opt-in forward into unrelated later exports (#1556).
      setPublishInCanvas(false);
      setCourseLink(null);
      loadIntegration();
    }
  }, [open, courseId]);

  const loadIntegration = async () => {
    try {
      const integrationData = await canvasService.getIntegration();

      if (integrationData?.isConnected) {
        setShowConnectForm(false);
        await loadCourseLink();
      } else {
        setShowConnectForm(true);
      }
    } catch (error) {
      console.error("Failed to load Canvas integration:", error);
    }
  };

  const loadCourseLink = async () => {
    setIsLoadingCourseLink(true);
    setCourseLink(courseId ? await canvasService.getCourseLink(courseId) : { status: "unlinked" });
    setIsLoadingCourseLink(false);
  };

  const handleConnect = async () => {
    if (!canvasUrl) {
      toast.error("Canvas URL required", { description: "Please enter your Canvas instance URL." });
      return;
    }

    if (!apiKey) {
      toast.error("API Key required", { description: "Please enter your Canvas API key." });
      return;
    }

    setIsConnecting(true);
    try {
      const { usedTestMode } = await canvasService.connectCanvasWithFallback(canvasUrl, apiKey);
      setShowConnectForm(false);
      if (usedTestMode) {
        toast("Canvas test mode", {
          description: "Using mock Canvas data because live credentials were unavailable.",
        });
      }
      await loadCourseLink();
    } catch (error: any) {
      toast.error("Failed to connect Canvas", {
        description: error.response?.data?.error || "Please check your credentials and try again.",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleExport = async () => {
    if (courseLink?.status !== "linked") {
      toast.error("Canvas course link required", {
        description: "Open a course that was fetched from Canvas before exporting.",
      });
      return;
    }

    setIsLoading(true);
    try {
      const result = await canvasService.exportAssessment(
        assessmentId,
        courseLink.mapping.canvasCourseId,
        {
          published: publishInCanvas,
        },
      );

      toast("Export successful!", {
        description: `Assessment exported to Canvas. ${result.questionsCreated} questions created.`,
      });

      if (onExportSuccess) {
        onExportSuccess({
          quizId: result.quizId,
          canvasUrl: result.canvasUrl,
        });
      }

      onClose();
    } catch (error: any) {
      toast.error("Export failed", {
        description: error.response?.data?.error || "Failed to export assessment to Canvas.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Export to Canvas LMS</DialogTitle>
          <DialogDescription>
            Export "{assessmentName}" to a Canvas course as a quiz.
          </DialogDescription>
        </DialogHeader>

        {!canManageCanvas ? (
          <p className="py-4 text-sm text-muted-foreground">
            Canvas export is available to instructors and administrators only.
          </p>
        ) : showConnectForm ? (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="canvasUrl">Canvas Instance URL</Label>
              <Input
                id="canvasUrl"
                placeholder="https://canvas.instructure.com"
                value={canvasUrl}
                onChange={(e) => setCanvasUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Your Canvas LMS instance URL (e.g., https://canvas.ubc.ca)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                type="password"
                placeholder="Enter your Canvas API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Generate an API key from your Canvas account settings
              </p>
            </div>

            <Button
              onClick={handleConnect}
              disabled={isConnecting || !canvasUrl || !apiKey}
              className="w-full"
            >
              {isConnecting ? "Connecting..." : "Connect Canvas"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Canvas course</Label>
              {isLoadingCourseLink ? (
                <div className="text-sm text-muted-foreground">Checking course link...</div>
              ) : courseLink?.status === "linked" ? (
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                  {courseLink.mapping.canvasCourseName ||
                    courseName ||
                    `Canvas course ${courseLink.mapping.canvasCourseId}`}
                </div>
              ) : courseLink?.status === "unknown" ? (
                <div className="text-sm text-muted-foreground">
                  Could not verify this course's Canvas link. Try again.
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  This Question Maker course is not linked to Canvas. Fetch it from Canvas in Core,
                  then open that fetched course here.
                </div>
              )}
            </div>

            {courseLink?.status === "linked" && (
              <>
                <label className="flex cursor-pointer items-start gap-2 pt-1">
                  <Checkbox
                    data-testid="export-publish-toggle"
                    checked={publishInCanvas}
                    onCheckedChange={(checked) => setPublishInCanvas(checked === true)}
                  />
                  <span className="text-sm">
                    Publish in Canvas
                    <span className="block text-xs text-muted-foreground">
                      Published quizzes are visible to students right away. Leave this off to export
                      a draft and publish it from Canvas yourself.
                    </span>
                  </span>
                </label>

                <div className="flex items-center justify-end pt-2">
                  <Button
                    onClick={handleExport}
                    disabled={isLoading}
                    data-testid="canvas-export-submit"
                  >
                    {isLoading ? "Exporting..." : "Export to Canvas"}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CanvasExportDialog;
