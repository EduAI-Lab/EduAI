import type { CourseNextStep } from "~/components/courses/CourseNextSteps";

type StepAction = Pick<CourseNextStep, "href" | "onSelect">;

/**
 * The one setup path the course, module and lesson pages all show (#2170):
 * module → lesson → activity → publish. Each page passes what it knows and how
 * to finish each step from there. Publishing is the last step, so it offers no
 * action until the three before it are done.
 */
export function setupSteps({
  hasModule,
  hasLesson,
  hasActivity,
  published,
  publishDetail,
  actions,
}: {
  hasModule: boolean;
  hasLesson: boolean;
  hasActivity: boolean;
  published: boolean;
  /** Where publishing stands on this page. */
  publishDetail: string;
  actions: {
    module?: StepAction;
    lesson?: StepAction;
    activity?: StepAction;
    publish?: StepAction;
  };
}): CourseNextStep[] {
  const ready = hasModule && hasLesson && hasActivity;
  return [
    {
      key: "module",
      label: "Add a module",
      done: hasModule,
      detail: 'A module is a unit of your course, like "Intro to Python". It holds lessons.',
      ...actions.module,
    },
    {
      key: "lesson",
      label: "Add a lesson",
      done: hasLesson,
      detail:
        'A lesson is one topic inside a module, like "Variables" or "Loops". It holds activities.',
      ...actions.lesson,
    },
    {
      key: "activity",
      label: "Add an activity",
      done: hasActivity,
      detail: "An activity is a question students answer, with the AI tutor's help.",
      ...actions.activity,
    },
    {
      key: "publish",
      label: "Publish for students",
      done: published,
      detail:
        ready || published
          ? publishDetail
          : "Last step: add a module, a lesson and an activity first.",
      ...(ready ? actions.publish : undefined),
    },
  ];
}
