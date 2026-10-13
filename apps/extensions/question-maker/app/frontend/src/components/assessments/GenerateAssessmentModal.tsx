/**
 * Modal for creating or editing an assessment blueprint (name, type, and the course topics it covers, #1974). The
 * assessment's semester/term is derived read-only from its linked Core course
 * (#1072 §4 step 8 / #1077) — not editable here.
 * Returns collected params to parent callbacks.
 */
import {
  Button,
  Input,
  Label,
  MultiSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@eduai/ui";
import { Tooltip } from "@/components/ui/tooltip";
import * as React from "react";
import { courseService } from "@/services/courseService";
import type { Topic } from "@/types/topic";
import { assessmentTypes, AssessmentGenerationParams, AssessmentType } from "../../types/question";

interface GenerateAssessmentModalProps {
  open: boolean;
  onClose: () => void;
  onGenerate?: (params: AssessmentGenerationParams) => void | Promise<void>;
  onUpdate?: (params: AssessmentGenerationParams) => void | Promise<void>;
  initialValues?: Partial<AssessmentGenerationParams>;
  mode?: "create" | "edit";
  courseId: number;
}

export const GenerateAssessmentModal = ({
  open,
  onClose,
  onGenerate,
  onUpdate,
  initialValues,
  mode = "create",
  courseId,
}: GenerateAssessmentModalProps) => {
  const isEdit = mode === "edit";
  const [assessmentName, setAssessmentName] = React.useState(initialValues?.name ?? "");
  const [assessmentType, setAssessmentType] = React.useState<AssessmentType>(
    initialValues?.type ?? "Assignment",
  );
  const [topics, setTopics] = React.useState<Topic[]>([]);
  const [selectedTopicIds, setSelectedTopicIds] = React.useState<string[]>(
    initialValues?.primaryTopicIds ?? [],
  );
  const [isSaving, setIsSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<{
    message: string;
    questions: { id: number; description: string | null }[];
  } | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setAssessmentName(initialValues?.name ?? "");
    setAssessmentType(initialValues?.type ?? "Assignment");
    setSelectedTopicIds(initialValues?.primaryTopicIds ?? []);
    setSaveError(null);
  }, [open, initialValues?.name, initialValues?.type, initialValues?.primaryTopicIds]);

  React.useEffect(() => {
    if (!open || courseId <= 0) return;
    let cancelled = false;
    courseService
      .getCourseTopics(courseId)
      .then((loaded) => {
        if (cancelled) return;
        setTopics(loaded);
        // A saved selection can outlive a topic removed in Core; keep only
        // topics this course still has.
        const known = new Set(loaded.map((topic) => topic.id));
        setSelectedTopicIds((prev) => prev.filter((id) => known.has(id)));
      })
      .catch(() => {
        if (!cancelled) setTopics([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, courseId]);

  const topicOptions = React.useMemo(
    () => topics.map((t) => ({ value: t.id, label: t.name })),
    [topics],
  );

  const canGenerate = courseId > 0 && assessmentName.trim().length > 0;

  const getDisabledReason = (): string | null => {
    if (!canGenerate) {
      const reasons: string[] = [];
      if (courseId <= 0) reasons.push("course");
      if (assessmentName.trim().length === 0) reasons.push("name");
      if (reasons.length > 0) {
        return `Missing required fields: ${reasons.join(", ")}`;
      }
    }
    return null;
  };

  const disabledReason = getDisabledReason();

  const handleGenerate = async () => {
    const difficultyDistribution = { easy: 0, medium: 0, hard: 0 };
    const reasoningDistribution = { factual: 0, analytical: 0, application: 0 };
    const reasoningData = {
      factual: { total: 0, easyBoundary: 0, hardBoundary: 0 },
      analytical: { total: 0, easyBoundary: 0, hardBoundary: 0 },
      application: { total: 0, easyBoundary: 0, hardBoundary: 0 },
    };

    const payload: AssessmentGenerationParams = {
      courseId,
      name: assessmentName.trim(),
      type: assessmentType,
      description: "",
      primaryTopicIds: selectedTopicIds,
      secondaryTopicIds: initialValues?.secondaryTopicIds ?? [],
      excludedTopicIds: initialValues?.excludedTopicIds ?? [],
      difficultyDistribution,
      reasoningDistribution,
      reasoningData,
    };

    setIsSaving(true);
    setSaveError(null);
    try {
      if (isEdit && onUpdate) await onUpdate(payload);
      else await onGenerate?.(payload);
      onClose();
    } catch (error: unknown) {
      const data = (
        error as {
          response?: {
            data?: {
              error?: string;
              details?: { questions?: { id: number; description: string | null }[] };
            };
          };
        }
      )?.response?.data;
      setSaveError({
        message: data?.error || "Failed to save assessment.",
        questions: data?.details?.questions ?? [],
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit assessment details" : "New assessment"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label htmlFor="assessmentName">
              Assessment name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="assessmentName"
              value={assessmentName}
              onChange={(e) => setAssessmentName(e.target.value)}
              placeholder="e.g. Midterm 1"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="assessmentType">Assessment type</Label>
            <Select
              value={assessmentType}
              onValueChange={(value) => {
                const nextType = assessmentTypes.find((type) => type === value);
                if (nextType) setAssessmentType(nextType);
              }}
            >
              <SelectTrigger id="assessmentType">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {assessmentTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="assessmentTopics">Topics covered</Label>
            <MultiSelect
              id="assessmentTopics"
              aria-label="Topics covered"
              options={topicOptions}
              value={selectedTopicIds}
              onValueChange={setSelectedTopicIds}
              placeholder="All topics"
              searchPlaceholder="Search topics…"
              emptyText="No topics"
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to allow all topics. Only questions from the chosen topics can be added.
            </p>
          </div>

          {saveError && (
            <div role="alert" className="space-y-1 text-sm text-destructive">
              <p>{saveError.message}</p>
              {saveError.questions.length > 0 && (
                <ul className="list-disc pl-5">
                  {saveError.questions.map((q) => (
                    <li key={q.id}>{q.description || `Question ${q.id}`}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {disabledReason ? (
            <Tooltip content={disabledReason} multiline>
              <span className="inline-block">
                <Button onClick={handleGenerate} disabled={!canGenerate || isSaving}>
                  {isEdit ? "Save changes" : "Create assessment"}
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Button onClick={handleGenerate} disabled={!canGenerate || isSaving}>
              {isEdit ? "Save Changes" : "Create Blueprint"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default GenerateAssessmentModal;
