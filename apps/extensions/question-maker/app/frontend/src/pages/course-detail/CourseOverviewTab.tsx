/**
 * Overview tab for the course workspace. The course's home base: identity (hero),
 * quick actions, an at-a-glance analytics block (type/difficulty/authoring/coverage),
 * and a note that enrollment is owned by Core. Read-only roster (Core is source of truth).
 */
import type { ReactNode } from 'react';
import { StatCard, Card, CardContent, QuestionAnalytics, type QuestionAnalyticsProps } from '@eduai/ui';
import {
  IconPlus,
  IconClipboardPlus,
  IconDownload,
  IconStack2,
} from '@tabler/icons-react';
import { EmptyState } from '@/components/shared/EmptyState';

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

function ActionCard({
  icon,
  label,
  description,
  color,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  description: string;
  color: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-start gap-3 rounded-[var(--radius-xl)] border border-border bg-card p-4 text-left shadow-[var(--shadow-2xs)] transition-shadow hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-[var(--shadow-2xs)]"
    >
      <div
        className="flex size-9 flex-shrink-0 items-center justify-center rounded-lg"
        style={{ background: color + '22' }}
      >
        <span style={{ color }}>{icon}</span>
      </div>
      <div>
        <div className="text-[13px] font-semibold text-foreground">{label}</div>
        <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{description}</div>
      </div>
    </button>
  );
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
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Questions" value={questionsCount} />
        <StatCard label="Assessments" value={assessmentsCount} />
        <StatCard label="Topics" value={topicsCount} />
      </div>

      {canWrite && (
        <div className="grid gap-3 sm:grid-cols-3">
          <ActionCard
            icon={<IconPlus size={18} />}
            label="Add question"
            description="Open the composer"
            color="#4F7BE5"
            onClick={onAddQuestion}
          />
          <ActionCard
            icon={<IconClipboardPlus size={18} />}
            label="New assessment"
            description="Build a quiz or exam"
            color="#2FA67A"
            onClick={onNewAssessment}
          />
          <ActionCard
            icon={<IconDownload size={18} />}
            label="Import from Canvas"
            description="Pull in a Canvas quiz"
            color="#D8902F"
            onClick={onImportFromCanvas}
          />
        </div>
      )}

      {questionsCount === 0 ? (
        <EmptyState
          icon={<IconStack2 className="size-6" />}
          title="No questions yet"
          description="Add questions to this course to unlock composition, difficulty, and coverage insights."
          primaryAction={canWrite ? { label: 'Add your first question', onClick: onAddQuestion, icon: <IconPlus className="size-4" /> } : undefined}
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
