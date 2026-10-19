import * as React from "react";
import { IconPlayerPlay } from "@tabler/icons-react";
import { Button } from "../ui/button";
import { LocalTour } from "../tour/local-tour";
import { useTour } from "../tour/tour-provider";
import { ONBOARDING_PAGES } from "./generated/pages";
import {
  onboardingTasks,
  resolveOnboardingPage,
  type OnboardingPlatform,
  type OnboardingPageId,
} from "./catalog";

interface ChecklistProps {
  platform: OnboardingPlatform;
  role?: string | null;
  userId: string;
  navigate: (to: string) => void;
}

type Progress = { completed: string[]; persistent: boolean };

// Stored as comma-separated task ids; unknown ids are ignored when counting.
function readProgress(key: string): Progress {
  try {
    const stored = window.localStorage.getItem(key) ?? "";
    return { completed: stored.split(",").filter(Boolean), persistent: true };
  } catch {
    return { completed: [], persistent: false };
  }
}

function Checklist({ platform, role, userId, navigate }: ChecklistProps) {
  const storageKey = `eduai:onboarding:v1:${platform}:${encodeURIComponent(userId)}`;
  const tasks = onboardingTasks(platform, role);
  const [progress, setProgress] = React.useState<Progress>({ completed: [], persistent: true });
  const [ready, setReady] = React.useState(false);
  const headingId = React.useId();

  React.useEffect(() => {
    setProgress(readProgress(storageKey));
    setReady(true);
  }, [storageKey]);

  if (!userId || tasks.length === 0) return null;
  const count = tasks.filter((task) => progress.completed.includes(task.id)).length;

  function toggle(id: string) {
    const completed = progress.completed.includes(id)
      ? progress.completed.filter((entry) => entry !== id)
      : [...progress.completed, id];
    let persistent = true;
    try {
      window.localStorage.setItem(storageKey, completed.join(","));
    } catch {
      persistent = false;
    }
    setProgress({ completed, persistent });
  }

  return (
    <section
      aria-labelledby={headingId}
      className="m-4 rounded-xl border bg-card p-4 text-card-foreground"
    >
      <h2 id={headingId} className="text-lg font-semibold">
        Getting started
      </h2>
      <p className="text-sm text-muted-foreground">
        Open a task, then tick it when you have finished. For course tasks, choose a course first.
      </p>
      <p aria-live="polite" className="my-2 text-sm">
        {count} of {tasks.length} complete
      </p>
      <ul className="space-y-2">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={!ready}
                checked={progress.completed.includes(task.id)}
                onChange={() => toggle(task.id)}
                className="size-4 accent-primary"
              />
              {task.label}
            </label>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Open ${task.label}`}
              onClick={() => navigate(task.href)}
            >
              Open
            </Button>
          </li>
        ))}
      </ul>
      <p
        className="mt-3 text-xs text-muted-foreground"
        role={progress.persistent ? undefined : "status"}
      >
        {progress.persistent
          ? "Progress is saved for your account in this browser only."
          : "Progress cannot be saved in this browser. It lasts only while this page is open."}
      </p>
    </section>
  );
}

export function OnboardingChecklist(props: ChecklistProps) {
  // Remount before showing a different account, including during client-side sign-in changes.
  return <Checklist key={`${props.platform}:${props.userId}`} {...props} />;
}

function PlayButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label="Play page tour"
      title={title}
      onClick={onClick}
    >
      <IconPlayerPlay className="size-4" aria-hidden />
      <span className="hidden sm:inline">Page tour</span>
    </Button>
  );
}

function PageTour({ pageId }: { pageId: OnboardingPageId }) {
  const [open, setOpen] = React.useState(false);
  const page = ONBOARDING_PAGES[pageId];
  return (
    <>
      <PlayButton title={`Tour: ${page.title}`} onClick={() => setOpen(true)} />
      <LocalTour steps={page.steps} open={open} onOpenChange={setOpen} portal />
    </>
  );
}

export function PageTourButton({
  platform,
  pathname,
  role,
  dashboardTour,
}: {
  platform: OnboardingPlatform;
  pathname: string;
  role?: string | null;
  /** The app's overview tour, played from the dashboard instead of auto-starting (#2004). */
  dashboardTour?: string;
}) {
  const { startTour } = useTour();
  if (dashboardTour && pathname === "/dashboard") {
    return <PlayButton title="Tour: Overview" onClick={() => startTour(dashboardTour)} />;
  }
  const pageId = resolveOnboardingPage(platform, pathname, role);
  return pageId ? <PageTour key={`${pathname}:${role}`} pageId={pageId} /> : null;
}
