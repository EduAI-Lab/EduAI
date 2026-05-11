/**
 * Modal for creating or editing an assessment blueprint (name, type, semester).
 * Returns collected params to parent callbacks.
 */
import * as React from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Tooltip } from '../ui/tooltip';
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

function getSemesterOptions(initialSemester?: string): string[] {
  const options: string[] = [];
  const now = new Date();
  const currentYear = now.getFullYear();
  const seasons = ['Winter', 'Spring', 'Summer', 'Fall'] as const;
  for (let y = currentYear - 1; y <= currentYear + 2; y++) {
    for (const season of seasons) {
      options.push(`${season} ${y}`);
    }
  }
  if (initialSemester?.trim() && !options.includes(initialSemester.trim())) {
    options.unshift(initialSemester.trim());
  }
  return options;
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
  const [assessmentSemester, setAssessmentSemester] = React.useState(() => {
    if (initialValues?.semester) return initialValues.semester;
    const now = new Date();
    return `Fall ${now.getFullYear()}`;
  });

  React.useEffect(() => {
    if (!open) return;
    setAssessmentName(initialValues?.name ?? '');
    setAssessmentType(initialValues?.type ?? 'Assignment');
    setAssessmentSemester(initialValues?.semester ?? `Fall ${new Date().getFullYear()}`);
  }, [open, initialValues?.name, initialValues?.type, initialValues?.semester]);

  const semesterOptions = React.useMemo(
    () => getSemesterOptions(assessmentSemester || initialValues?.semester),
    [assessmentSemester, initialValues?.semester]
  );

  const canGenerate =
    courseId > 0 &&
    assessmentName.trim().length > 0 &&
    assessmentSemester.trim().length > 0;

  const getDisabledReason = (): string | null => {
    if (!canGenerate) {
      const reasons: string[] = [];
      if (courseId <= 0) reasons.push('course');
      if (assessmentName.trim().length === 0) reasons.push('name');
      if (assessmentSemester.trim().length === 0) reasons.push('semester');
      if (reasons.length > 0) {
        return `Missing required fields: ${reasons.join(', ')}`;
      }
    }
    return null;
  };

  const disabledReason = getDisabledReason();

  if (!open) return null;

  const handleGenerate = () => {
    // Provide default values for removed difficulty matrix fields
    const difficultyDistribution = {
      easy: 0,
      medium: 0,
      hard: 0
    };

    const reasoningDistribution = {
      factual: 0,
      analytical: 0,
      application: 0
    };

    const reasoningData = {
      factual: {
        total: 0,
        easyBoundary: 0,
        hardBoundary: 0
      },
      analytical: {
        total: 0,
        easyBoundary: 0,
        hardBoundary: 0
      },
      application: {
        total: 0,
        easyBoundary: 0,
        hardBoundary: 0
      }
    };

    const payload: AssessmentGenerationParams = {
      courseId,
      name: assessmentName.trim(),
      type: assessmentType,
      description: '',
      semester: assessmentSemester.trim(),
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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <Card className="relative flex w-full max-w-4xl max-h-[90vh] flex-col overflow-hidden">
        <CardHeader className="border-b">
          <CardTitle>{isEdit ? 'Edit Assessment Blueprint' : 'Create Assessment Blueprint'}</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 space-y-6 overflow-y-auto py-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="assessmentName">Assessment name</Label>
              <Input
                id="assessmentName"
                value={assessmentName}
                onChange={(e) => setAssessmentName(e.target.value)}
                placeholder="e.g. Midterm 1"
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
            <div className="space-y-2">
              <Label htmlFor="assessmentSemester">Semester</Label>
              <Select value={assessmentSemester} onValueChange={setAssessmentSemester}>
                <SelectTrigger id="assessmentSemester">
                  <SelectValue placeholder="Select semester" />
                </SelectTrigger>
                <SelectContent>
                  {semesterOptions.map((sem) => (
                    <SelectItem key={sem} value={sem}>
                      {sem}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end gap-3 border-t bg-muted/40 py-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {disabledReason ? (
            <Tooltip content={disabledReason} multiline>
              <span className="inline-block">
                <Button onClick={handleGenerate} disabled={!canGenerate}>
                  Save Blueprint
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Button onClick={handleGenerate} disabled={!canGenerate}>
              Save Blueprint
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
};

export default GenerateAssessmentModal;
