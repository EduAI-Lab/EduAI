import { Spinner } from '@eduai/ui';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Textarea,
} from '@eduai/ui';

type StudentActivityFeedbackCardProps = {
  rating: number | null;
  note: string;
  saving: boolean;
  submitted: boolean;
  error: string | null;
  onSelectRating: (value: number) => void;
  onNoteChange: (value: string) => void;
  onSubmit: () => void;
  onDismiss: () => void;
};

export default function StudentActivityFeedbackCard({
  rating,
  note,
  saving,
  submitted,
  error,
  onSelectRating,
  onNoteChange,
  onSubmit,
  onDismiss,
}: StudentActivityFeedbackCardProps) {
  if (submitted) {
    return (
      <Card
        style={{
          borderColor: 'var(--color-success-500)',
          background: 'var(--color-success-100)',
        }}
      >
        <CardContent className="text-sm text-[var(--color-success-700)]">
          Thanks for the feedback. We use it to improve future activities.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Quick feedback</CardTitle>
            <CardDescription>How did this activity feel after your first attempt?</CardDescription>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss} className="shrink-0">
            Maybe later
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="text-sm font-medium text-foreground">Rate the difficulty</div>
          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <Button
                key={value}
                type="button"
                variant={rating === value ? 'primary' : 'outline'}
                onClick={() => onSelectRating(value)}
                aria-pressed={rating === value}
                className="w-full"
              >
                {value}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">1 = very easy, 5 = very difficult</p>
        </div>

        <div className="space-y-2">
          <label
            className="block text-sm font-medium text-foreground"
            htmlFor="activity-feedback-note"
          >
            Optional note
          </label>
          <Textarea
            id="activity-feedback-note"
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="What made this question easy or difficult?"
            className="min-h-24 resize-y text-sm"
          />
        </div>

        {error && (
          <div className="rounded-[var(--radius-lg)] border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </CardContent>

      <CardFooter className="flex items-center gap-3">
        <Button type="button" variant="primary" onClick={onSubmit} disabled={!rating || saving}>
          {saving ? (
            <>
              <Spinner className="mr-1" />
              Saving...
            </>
          ) : (
            'Send feedback'
          )}
        </Button>
        <p className="text-xs text-muted-foreground">
          Your response stays internal and helps us tune the course.
        </p>
      </CardFooter>
    </Card>
  );
}
