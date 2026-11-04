import { useEffect, useState } from "react";
import { Link } from "react-router";
import { IconCheck, IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { Tooltip, TooltipContent, TooltipTrigger, cn } from "@eduai/ui";

export type CourseNextStep = {
  key: string;
  label: string;
  done: boolean;
  /** What the step means and where it stands, shown on hover. */
  detail: string;
  /** Where to go to finish it. */
  href?: string;
};

const COLLAPSED_KEY = "eduai.course.nextStepsCollapsed";

/**
 * The course's setup path as one compact step bar (#2105): material added →
 * ready for the AI → published. Collapsible, with each step's detail on hover,
 * so it never takes over the page.
 */
export function CourseNextSteps({ steps }: { steps: CourseNextStep[] }) {
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSED_KEY);
      // A finished setup tucks itself away unless the instructor chose otherwise.
      setCollapsed(stored === null ? allDone : stored === "1");
    } catch {
      setCollapsed(allDone);
    }
  }, [allDone]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // Not remembered across visits.
    }
  };

  const nextStep = steps.find((s) => !s.done);

  return (
    <section
      aria-label="Course setup"
      className="mb-5 rounded-lg border border-border bg-card px-4 py-3"
      data-tour="course-next-steps"
    >
      <div className="flex items-center gap-3">
        <p className="text-sm font-semibold text-foreground">
          {allDone ? "Course is set up" : "Next steps"}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {doneCount} of {steps.length} done
          </span>
        </p>
        {collapsed && nextStep && (
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            Next: {nextStep.label}
          </p>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {collapsed ? "Show" : "Hide"}
          {collapsed ? (
            <IconChevronDown className="size-3.5" />
          ) : (
            <IconChevronUp className="size-3.5" />
          )}
        </button>
      </div>

      {!collapsed && (
        <ol className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-0">
          {steps.map((step, i) => {
            const isNext = step === nextStep;
            const body = (
              <span className="inline-flex items-center gap-2">
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                    step.done
                      ? "border-transparent bg-[var(--color-success-500)] text-white"
                      : isNext
                        ? "border-primary text-primary-text"
                        : "border-border text-muted-foreground",
                  )}
                >
                  {step.done ? <IconCheck className="size-3.5" aria-hidden="true" /> : i + 1}
                </span>
                <span
                  className={cn(
                    "text-xs font-medium",
                    step.done ? "text-muted-foreground" : "text-foreground",
                    isNext && step.href && "underline-offset-2 group-hover:underline",
                  )}
                >
                  {step.label}
                  <span className="sr-only">
                    {step.done ? " (done)" : " (to do)"}: {step.detail}
                  </span>
                </span>
              </span>
            );
            return (
              <li key={step.key} className="flex items-center sm:flex-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    {step.href && !step.done ? (
                      <Link to={step.href} className="group rounded-md focus-visible:ring-2">
                        {body}
                      </Link>
                    ) : (
                      <span tabIndex={0} className="rounded-md focus-visible:ring-2">
                        {body}
                      </span>
                    )}
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">{step.detail}</TooltipContent>
                </Tooltip>
                {i < steps.length - 1 && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mx-3 hidden h-px flex-1 sm:block",
                      step.done ? "bg-[var(--color-success-500)]" : "bg-border",
                    )}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
