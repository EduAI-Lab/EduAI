/**
 * Dialog for exporting an assessment to Canvas, handling integration setup and course selection.
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@eduai/ui";
import { Button, Checkbox, Label, Input } from "@eduai/ui";
import { PermissionGate } from "@eduai/ui";
import { useQmPermissionsForCourse } from "@/hooks/useQmPermissions";
import canvasService, { CanvasCourse, CanvasIntegration } from "../../services/canvasService";
import { toast } from "sonner";

interface CanvasExportDialogProps {
  open: boolean;
  onClose: () => void;
  assessmentId: number;
  assessmentName: string;
  courseId?: number | null;
  onExportSuccess?: (result: { quizId: number; canvasUrl: string }) => void;
}

export const CanvasExportDialog = ({
  open,
  onClose,
  assessmentId,
  assessmentName,
  courseId = null,
  onExportSuccess,
}: CanvasExportDialogProps) => {
  const { canManageCanvas } = useQmPermissionsForCourse(courseId);
  const [integration, setIntegration] = useState<CanvasIntegration | null>(null);
  const [courses, setCourses] = useState<CanvasCourse[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  // A published quiz is live to students the moment it lands, so the choice is
  // surfaced rather than assumed — defaulting to published (#1556).
  const [publishInCanvas, setPublishInCanvas] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
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
      // one opt-out forward into unrelated later exports (#1556).
      setPublishInCanvas(true);
      loadIntegration();
    }
  }, [open]);

  const loadIntegration = async () => {
    try {
      const integrationData = await canvasService.getIntegration();
      setIntegration(integrationData);

      if (integrationData?.isConnected) {
        await loadCourses();
      } else {
        setShowConnectForm(true);
      }
    } catch (error) {
      console.error("Failed to load Canvas integration:", error);
    }
  };

  const loadCourses = async () => {
    setIsLoadingCourses(true);
    try {
      const canvasCourses = await canvasService.getCourses();
      setCourses(canvasCourses);
    } catch (error: any) {
      toast.error("Failed to load Canvas courses", {
        description: error.response?.data?.error || "Please check your Canvas connection.",
      });
    } finally {
      setIsLoadingCourses(false);
    }
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
      const { integration: result, usedTestMode } = await canvasService.connectCanvasWithFallback(
        canvasUrl,
        apiKey,
      );
      setIntegration(result);
      setShowConnectForm(false);
      if (usedTestMode) {
        toast("Canvas test mode", {
          description: "Using mock Canvas data because live credentials were unavailable.",
        });
      }
      await loadCourses();
    } catch (error: any) {
      toast.error("Failed to connect Canvas", {
        description: error.response?.data?.error || "Please check your credentials and try again.",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleExport = async () => {
    if (!selectedCourseId) {
      toast.error("Course required", {
        description: "Please select a Canvas course to export to.",
      });
      return;
    }

    setIsLoading(true);
    try {
      const result = await canvasService.exportAssessment(
        assessmentId,
        parseInt(selectedCourseId),
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
              <Label htmlFor="canvasCourse">Select Canvas Course</Label>
              {isLoadingCourses ? (
                <div className="text-sm text-muted-foreground">Loading courses...</div>
              ) : courses.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No courses found. Make sure you are enrolled as an instructor.
                </div>
              ) : (
                <Select value={selectedCourseId} onValueChange={setSelectedCourseId}>
                  <SelectTrigger id="canvasCourse">
                    <SelectValue placeholder="Select a course" />
                  </SelectTrigger>
                  <SelectContent>
                    {courses.map((course) => (
                      <SelectItem key={course.id} value={course.id.toString()}>
                        {course.course_code ? `${course.course_code} - ` : ""}
                        {course.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <label className="flex cursor-pointer items-start gap-2 pt-1">
              <Checkbox
                data-testid="export-publish-toggle"
                checked={publishInCanvas}
                onCheckedChange={(checked) => setPublishInCanvas(checked === true)}
              />
              <span className="text-sm">
                Publish in Canvas
                <span className="block text-xs text-muted-foreground">
                  Published quizzes are visible to students right away. Leave this off to export a
                  draft and publish it from Canvas yourself.
                </span>
              </span>
            </label>

            <div className="flex items-center justify-end pt-2">
              <Button
                onClick={handleExport}
                disabled={isLoading || !selectedCourseId || courses.length === 0}
                data-testid="canvas-export-submit"
              >
                {isLoading ? "Exporting..." : "Export to Canvas"}
              </Button>
            </div>
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
