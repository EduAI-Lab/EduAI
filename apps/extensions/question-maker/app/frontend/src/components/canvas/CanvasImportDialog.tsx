/**
 * Dialog for importing a Canvas quiz into a local assessment with topic selection.
 * Handles integration checks, course/quiz selection, and imports while reporting skips.
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
import { Button, Label, Input } from "@eduai/ui";
import { useQmPermissionsForCourse } from "@/hooks/useQmPermissions";
import canvasService, {
  CanvasIntegration,
  CanvasQuiz,
  CanvasSkippedQuestion,
} from "../../services/canvasService";
import { courseService } from "../../services/courseService";
import { Topic } from "../../types/topic";
import { toast } from "sonner";

interface CanvasCourseLink {
  canvasCourseId: number;
  canvasCourseName: string;
}

interface CanvasImportDialogProps {
  open: boolean;
  onClose: () => void;
  courseId?: number | null;
  onImportSuccess?: (result: { assessmentId: number; assessmentName: string }) => void;
}

export const CanvasImportDialog = ({
  open,
  onClose,
  courseId = null,
  onImportSuccess,
}: CanvasImportDialogProps) => {
  const { canManageCanvas } = useQmPermissionsForCourse(courseId);
  const [integration, setIntegration] = useState<CanvasIntegration | null>(null);
  // Neither course is picked: quizzes come from the Canvas course this course is
  // linked to, and the assessment lands in this course.
  const [linkedCanvasCourse, setLinkedCanvasCourse] = useState<CanvasCourseLink | null>(null);
  const [isLoadingMapping, setIsLoadingMapping] = useState(false);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [quizzes, setQuizzes] = useState<CanvasQuiz[]>([]);

  const [selectedQuizId, setSelectedQuizId] = useState<string>("");
  const [selectedTopicId, setSelectedTopicId] = useState<string>("");
  const [assessmentName, setAssessmentName] = useState<string>("");
  const [assessmentType, setAssessmentType] = useState<string>("Quiz");

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingQuizzes, setIsLoadingQuizzes] = useState(false);
  const [isLoadingTopics, setIsLoadingTopics] = useState(false);

  // Load integration status
  useEffect(() => {
    if (open) {
      loadIntegration();
    }
  }, [open]);

  // Resolve the Canvas course linked to the course in context, then its quizzes
  useEffect(() => {
    if (!open || !courseId || !integration?.isConnected) {
      setLinkedCanvasCourse(null);
      setQuizzes([]);
      setSelectedQuizId("");
      return;
    }
    void loadLinkedCanvasCourse(courseId);
  }, [open, courseId, integration]);

  // Topics always come from the course in context
  useEffect(() => {
    if (open && courseId) {
      loadTopics(courseId);
    } else {
      setTopics([]);
      setSelectedTopicId("");
    }
  }, [open, courseId]);

  // Update assessment name when quiz is selected
  useEffect(() => {
    if (selectedQuizId && quizzes.length > 0) {
      const quiz = quizzes.find((q) => q.id.toString() === selectedQuizId);
      if (quiz && !assessmentName) {
        setAssessmentName(quiz.title);
      }
    }
  }, [selectedQuizId, quizzes]);

  const loadIntegration = async () => {
    try {
      const integrationData = await canvasService.getIntegration();
      setIntegration(integrationData);
    } catch (error) {
      console.error("Failed to load Canvas integration:", error);
    }
  };

  /** Resolves the Canvas course this local course was synced from; null when unlinked. */
  const loadLinkedCanvasCourse = async (localCourseId: number) => {
    setIsLoadingMapping(true);
    try {
      const mapping = await canvasService.getCourseMapping(localCourseId);
      const canvasCourseId = mapping?.canvasCourseId ? Number(mapping.canvasCourseId) : null;
      if (!canvasCourseId) {
        setLinkedCanvasCourse(null);
        setQuizzes([]);
        setSelectedQuizId("");
        return;
      }
      setLinkedCanvasCourse({
        canvasCourseId,
        canvasCourseName: mapping.canvasCourseName || `Canvas course ${canvasCourseId}`,
      });
      await loadQuizzes(canvasCourseId);
    } finally {
      setIsLoadingMapping(false);
    }
  };

  const loadQuizzes = async (canvasCourseId: number) => {
    setIsLoadingQuizzes(true);
    try {
      const quizList = await canvasService.getQuizzes(canvasCourseId);
      setQuizzes(quizList);
    } catch (error: any) {
      toast.error("Failed to load quizzes", {
        description: error.response?.data?.error || "Failed to load quizzes from Canvas.",
      });
      setQuizzes([]);
    } finally {
      setIsLoadingQuizzes(false);
    }
  };

  const loadTopics = async (courseId: number) => {
    setIsLoadingTopics(true);
    try {
      const topicList = await courseService.getCourseTopics(courseId);
      setTopics(topicList);
      if (topicList.length > 0 && !selectedTopicId) {
        setSelectedTopicId(topicList[0].id.toString());
      }
    } catch (error) {
      console.error("Failed to load topics:", error);
      setTopics([]);
    } finally {
      setIsLoadingTopics(false);
    }
  };

  const handleImport = async () => {
    if (!courseId || !linkedCanvasCourse) {
      toast.error("Course not linked to Canvas", {
        description: "Sync this course from Canvas before importing.",
      });
      return;
    }

    if (!selectedQuizId) {
      toast.error("Quiz required", { description: "Please select a quiz to import." });
      return;
    }

    if (!selectedTopicId) {
      toast.error("Topic required", {
        description: "Please select a primary topic for the imported questions.",
      });
      return;
    }

    if (!assessmentName.trim()) {
      toast.error("Assessment name required", {
        description: "Please enter a name for the assessment.",
      });
      return;
    }

    setIsLoading(true);
    try {
      const result = await canvasService.importQuiz(
        linkedCanvasCourse.canvasCourseId,
        parseInt(selectedQuizId),
        courseId,
        {
          assessmentType,
          assessmentName: assessmentName.trim(),
          primaryTopicId: parseInt(selectedTopicId),
        },
      );

      // Build success message
      let description = `Imported ${result.questionsImported} question${result.questionsImported !== 1 ? "s" : ""} from Canvas.`;
      if (result.questionsSkipped && result.questionsSkipped > 0) {
        description += ` ${result.questionsSkipped} question${result.questionsSkipped !== 1 ? "s were" : " was"} skipped due to unsupported question types.`;
      }

      toast("Import successful!", { description: description });

      // If there are skipped questions, show details in console and optionally in a longer toast
      if (result.skippedQuestions && result.skippedQuestions.length > 0) {
        console.warn("Skipped questions during import:", result.skippedQuestions);
        // Show additional toast with details if there are many skipped questions
        if (result.skippedQuestions.length > 3) {
          toast("Some questions were skipped", {
            description: `${result.skippedQuestions.length} questions with unsupported types were not imported. Check the browser console for details.`,
          });
        }
      }

      if (onImportSuccess) {
        onImportSuccess({
          assessmentId: result.assessmentId,
          assessmentName: result.assessmentName,
        });
      }

      // Reset form
      setSelectedQuizId("");
      setSelectedTopicId("");
      setAssessmentName("");

      onClose();
    } catch (error: any) {
      toast.error("Import failed", {
        description: error.response?.data?.error || "Failed to import quiz from Canvas.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const canImport =
    integration?.isConnected &&
    linkedCanvasCourse &&
    selectedQuizId &&
    selectedTopicId &&
    assessmentName.trim() &&
    !isLoading;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col overflow-hidden p-0 gap-0">
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle>Import from Canvas LMS</DialogTitle>
          <DialogDescription>
            Import a quiz from Canvas as a new assessment in Question Maker.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!canManageCanvas ? (
            <p className="text-sm text-muted-foreground">
              Canvas import is available to instructors and administrators only.
            </p>
          ) : !integration?.isConnected ? (
            <p className="text-sm text-muted-foreground">
              Canvas is not connected. Connect Canvas in your EduAI settings, then reopen this
              dialog.
            </p>
          ) : !courseId ? (
            <p className="text-sm text-muted-foreground">
              Select a course before importing from Canvas.
            </p>
          ) : isLoadingMapping ? (
            <div className="text-sm text-muted-foreground">Loading Canvas course...</div>
          ) : !linkedCanvasCourse ? (
            <p className="text-sm text-muted-foreground">
              This course is not linked to a Canvas course. Sync the course from Canvas before
              importing quizzes.
            </p>
          ) : (
            <div className="space-y-4">
              {/* Linked Canvas course — not selectable */}
              <div className="space-y-2">
                <Label>Canvas Course</Label>
                <p className="text-sm" data-testid="linked-canvas-course">
                  {linkedCanvasCourse.canvasCourseName}
                </p>
                <p className="text-xs text-muted-foreground">
                  Quizzes import from the Canvas course this course is linked to, into this course.
                </p>
              </div>

              {/* Quiz Selection */}
              <div className="space-y-2">
                <Label htmlFor="quiz">Quiz</Label>
                {isLoadingQuizzes ? (
                  <div className="text-sm text-muted-foreground">Loading quizzes...</div>
                ) : quizzes.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No quizzes found in this course.
                  </div>
                ) : (
                  <Select value={selectedQuizId} onValueChange={setSelectedQuizId}>
                    <SelectTrigger id="quiz">
                      <SelectValue placeholder="Select a quiz" />
                    </SelectTrigger>
                    <SelectContent>
                      {quizzes.map((quiz) => (
                        <SelectItem key={quiz.id} value={quiz.id.toString()}>
                          {quiz.title} {quiz.published ? "(Published)" : "(Unpublished)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Topic Selection */}
              <div className="space-y-2">
                <Label htmlFor="topic">Primary Topic (Required)</Label>
                {isLoadingTopics ? (
                  <div className="text-sm text-muted-foreground">Loading topics...</div>
                ) : topics.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No topics found. Please create a topic for this course first.
                  </div>
                ) : (
                  <Select value={selectedTopicId} onValueChange={setSelectedTopicId}>
                    <SelectTrigger id="topic">
                      <SelectValue placeholder="Select a topic" />
                    </SelectTrigger>
                    <SelectContent>
                      {topics.map((topic) => (
                        <SelectItem key={topic.id} value={topic.id.toString()}>
                          {topic.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-xs text-muted-foreground">
                  All imported questions will be assigned to this topic.
                </p>
              </div>

              {/* Assessment Details */}
              <div className="space-y-2">
                <Label htmlFor="assessmentName">Assessment Name</Label>
                <Input
                  id="assessmentName"
                  placeholder="Enter assessment name"
                  value={assessmentName}
                  onChange={(e) => setAssessmentName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="assessmentType">Assessment Type</Label>
                <Select value={assessmentType} onValueChange={setAssessmentType}>
                  <SelectTrigger id="assessmentType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Quiz">Quiz</SelectItem>
                    <SelectItem value="Assignment">Assignment</SelectItem>
                    <SelectItem value="Exam">Exam</SelectItem>
                    <SelectItem value="Midterm">Midterm</SelectItem>
                    <SelectItem value="Final">Final</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 border-t border-border px-6 py-4 flex-row gap-2 sm:justify-between">
          <Button variant="outline" onClick={onClose}>
            {canManageCanvas ? "Cancel" : "Close"}
          </Button>
          {canManageCanvas && (
            <Button onClick={handleImport} disabled={!canImport} data-testid="canvas-import-submit">
              {isLoading ? "Importing..." : "Import from Canvas"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CanvasImportDialog;
