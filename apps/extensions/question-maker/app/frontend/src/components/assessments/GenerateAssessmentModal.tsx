/**
 * Modal for creating or editing an assessment blueprint (name, type). The
 * assessment's semester/term is derived read-only from its linked Core course
 * (#1072 §4 step 8 / #1077) — not editable here.
 * Returns collected params to parent callbacks.
 */
import {
    Button,
    Input,
    Label,
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
} from '@eduai/ui';
import { Tooltip } from '@/components/ui/tooltip';
import * as React from 'react';
import { AssessmentGenerationParams, AssessmentType } from '../../types/question';

interface GenerateAssessmentModalProps {
  open: boolean;
  onClose: () => void;
  onGenerate?: (params: AssessmentGenerationParams) => void;
  onUpdate?: (params: AssessmentGenerationParams) => void;
  initialValues?: Partial<AssessmentGenerationParams>;
  mode?: 'create' | 'edit';
  courseId: number;
}

export const GenerateAssessmentModal = ({
  open,
  onClose,
  onGenerate,
  onUpdate,
  initialValues,
  mode = 'create',
  courseId
}: GenerateAssessmentModalProps) => {
  const isEdit = mode === 'edit';
  const [assessmentName, setAssessmentName] = React.useState(initialValues?.name ?? '');
  const [assessmentType, setAssessmentType] = React.useState<AssessmentType>(initialValues?.type ?? 'Assignment');

  React.useEffect(() => {
    if (!open) return;
    setAssessmentName(initialValues?.name ?? '');
    setAssessmentType(initialValues?.type ?? 'Assignment');
  }, [open, initialValues?.name, initialValues?.type]);

  const canGenerate = courseId > 0 && assessmentName.trim().length > 0;

  const getDisabledReason = (): string | null => {
    if (!canGenerate) {
      const reasons: string[] = [];
      if (courseId <= 0) reasons.push('course');
      if (assessmentName.trim().length === 0) reasons.push('name');
      if (reasons.length > 0) {
        return `Missing required fields: ${reasons.join(', ')}`;
      }
    }
    return null;
  };

  const disabledReason = getDisabledReason();

  const handleGenerate = () => {
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
      description: '',
      primaryTopicIds: initialValues?.primaryTopicIds ?? [],
      secondaryTopicIds: initialValues?.secondaryTopicIds ?? [],
      excludedTopicIds: initialValues?.excludedTopicIds ?? [],
      difficultyDistribution,
      reasoningDistribution,
      reasoningData
    };

    if (isEdit && onUpdate) {
      onUpdate(payload);
    } else {
      onGenerate?.(payload);
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Edit assessment details' : 'New assessment'}
          </DialogTitle>
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
            <Select value={assessmentType} onValueChange={(value) => setAssessmentType(value as AssessmentType)}>
              <SelectTrigger id="assessmentType">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {(['Assignment', 'Lab', 'Quiz', 'Midterm', 'Final'] as AssessmentType[]).map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {disabledReason ? (
            <Tooltip content={disabledReason} multiline>
              <span className="inline-block">
                <Button onClick={handleGenerate} disabled={!canGenerate}>
                  {isEdit ? 'Save changes' : 'Create assessment'}
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Button onClick={handleGenerate} disabled={!canGenerate}>
              {isEdit ? 'Save Changes' : 'Create Blueprint'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default GenerateAssessmentModal;
