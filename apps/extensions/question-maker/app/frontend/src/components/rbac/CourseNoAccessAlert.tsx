type CourseNoAccessAlertProps = {
  onGoToCourses: () => void;
};

/** Shown when the selected course fails per-course access checks (§3). */
export function CourseNoAccessAlert({ onGoToCourses }: CourseNoAccessAlertProps) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      You do not have access to this course. Choose a course from the list or return to{' '}
      <button type="button" className="underline font-medium" onClick={onGoToCourses}>
        course selection
      </button>
      .
    </div>
  );
}
