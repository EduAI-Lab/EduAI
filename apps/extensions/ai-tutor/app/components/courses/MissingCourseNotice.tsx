import { IconInfoCircle } from "@tabler/icons-react";
import { Alert, AlertDescription, AlertTitle } from "@eduai/ui";
import { getLauncherApps } from "~/lib/apps";

const COPY = {
  student: {
    title: "This course isn't open in AI Tutor yet.",
    body: "Your instructor hasn't published it.",
  },
  staff: {
    title: "This course isn't set up in AI Tutor yet.",
    body: "AI Tutor courses come from EduAI Core. Enable AI Tutor for the course there and publish it when it's ready.",
  },
} satisfies Record<"student" | "staff", { title: string; body: string }>;

/** Shown on the course list when `?coreCourseId=` matched no AI Tutor course (#2158). */
export function MissingCourseNotice({
  coreCourseId,
  audience,
}: {
  coreCourseId: string;
  audience: "student" | "staff";
}) {
  const coreUrl = getLauncherApps(coreCourseId).find((app) => app.id === "core")?.url;
  const { title, body } = COPY[audience];
  return (
    <Alert data-testid="missing-course-notice">
      <IconInfoCircle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{body}</p>
        {coreUrl && (
          <a href={coreUrl} className="mt-1 inline-block font-medium underline underline-offset-2">
            Back to course in Core
          </a>
        )}
      </AlertDescription>
    </Alert>
  );
}
