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
      <div className="rounded-2xl border border-accent/30 bg-accent/10 p-4 text-sm text-accent-foreground animate-scale-in">
        Thanks for the feedback. We use it to improve future activities.
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-border bg-card/90 p-5 shadow-sm animate-scale-in">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold text-foreground">Quick feedback</h3>
            <p className="text-sm text-muted-foreground">
              How did this activity feel after your first attempt?
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs font-medium text-muted-foreground hover:text-foreground transition"
          >
            Maybe later
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <div className="space-y-2">
          <div className="text-sm font-medium text-foreground">Rate the difficulty</div>
          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onSelectRating(value)}
                className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition ${
                  rating === value
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : 'border-border bg-background text-foreground hover:border-primary/40 hover:bg-primary/5'
                }`}
                aria-pressed={rating === value}
              >
                {value}
              </button>
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
          <textarea
            id="activity-feedback-note"
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="What made this question easy or difficult?"
            className="input-field min-h-24 resize-y text-sm"
          />
        </div>

        {error && (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSubmit}
            disabled={!rating || saving}
            className="btn-primary"
          >
            {saving ? 'Saving...' : 'Send feedback'}
          </button>
          <p className="text-xs text-muted-foreground">
            Your response stays internal and helps us tune the course.
          </p>
        </div>
      </div>
    </div>
  );
}
