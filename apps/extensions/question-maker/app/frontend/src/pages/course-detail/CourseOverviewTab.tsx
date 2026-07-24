/**
 * Overview tab for the course workspace. The course's home base: identity (hero),
 * quick actions, an at-a-glance analytics block (type/difficulty/authoring/coverage),
 * and a note that enrollment is owned by Core. Read-only roster (Core is source of truth).
 */
import {
  StatCard,
  Card,
  CardContent,
  QuestionAnalytics,
  type QuestionAnalyticsProps,
  EmptyState,
  QuickActionsPanel,
  type QuickAction,
  Button,
} from '@eduai/ui';
import {
  IconPlus,
  IconClipboardPlus,
  IconDownload,
  IconStack2,
} from '@tabler/icons-react';

interface CourseOverviewTabProps {
  questionsCount: number;
  assessmentsCount: number;
  topicsCount: number;
  analytics: QuestionAnalyticsProps;
  canWrite: boolean;
  onAddQuestion: () => void;
  onNewAssessment: () => void;
  onImportFromCanvas: () => void;
}

export const CourseOverviewTab = ({
  questionsCount,
  assessmentsCount,
  topicsCount,
  analytics,
  canWrite,
  onAddQuestion,
  onNewAssessment,
  onImportFromCanvas,
}: CourseOverviewTabProps) => {
  const quickActions: QuickAction[] = [
    {
      label: 'Add question',
      description: 'Open the composer',
      icon: <IconPlus size={18} />,
      color: '#4F7BE5',
      onClick: onAddQuestion,
    },
    {
      label: 'New assessment',
      description: 'Build a quiz or exam',
      icon: <IconClipboardPlus size={18} />,
      color: '#2FA67A',
      onClick: onNewAssessment,
    },
    {
      label: 'Import from Canvas',
      description: 'Pull in a Canvas quiz',
      icon: <IconDownload size={18} />,
      color: '#D8902F',
      onClick: onImportFromCanvas,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Questions" value={questionsCount} />
        <StatCard label="Assessments" value={assessmentsCount} />
        <StatCard label="Topics" value={topicsCount} />
      </div>

      {canWrite && (
        <QuickActionsPanel actions={quickActions} className="sm:grid-cols-3" />
      )}

      {questionsCount === 0 ? (
        <EmptyState
          icon={<IconStack2 className="size-6" />}
          title="No questions yet"
          description="Add questions to this course to unlock composition, difficulty, and coverage insights."
          bare={false}
          action={
            canWrite ? (
              <Button onClick={onAddQuestion}>
                <IconPlus className="size-4" />
                Add your first question
              </Button>
            ) : undefined
          }
        />
      ) : (
        <QuestionAnalytics {...analytics} />
      )}

      <Card>
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            Student enrollments and permissions are managed in EduAI Core. Changes to course access are
            reflected here automatically.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
