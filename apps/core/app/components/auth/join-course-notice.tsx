/**
 * What a signed-out visitor who arrived from a course join link reads on sign-in
 * and sign-up (#1961): which course the account is for, and that a new account
 * joins it once the email is verified.
 */
export function JoinCourseNotice({
  courseCode,
  courseName,
  action,
  canRegister = true,
}: {
  courseCode: string;
  courseName: string;
  action: "sign-in" | "sign-up";
  canRegister?: boolean;
}) {
  const course = `${courseCode} · ${courseName}`;
  return (
    <div className="mb-6 rounded-md border bg-muted/50 p-3 text-center text-sm">
      {action === "sign-in" ? (
        <>
          <p className="font-medium text-foreground">Sign in to join {course}.</p>
          {canRegister && (
            <p className="mt-1 text-muted-foreground">
              New to EduAI? Create an account and you&apos;ll be added once you verify your email.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="font-medium text-foreground">Create your account to join {course}.</p>
          <p className="mt-1 text-muted-foreground">
            You&apos;ll be added to the course once you verify your email.
          </p>
        </>
      )}
    </div>
  );
}
