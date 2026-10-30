import * as React from "react";
import {
  IconChecklist,
  IconCircle,
  IconCircleCheckFilled,
  IconPlayerPlay,
  IconX,
} from "@tabler/icons-react";
import { Button } from "../ui/button";
import { toast } from "sonner";
import { Progress } from "../ui/progress";
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
  /** The dashboard the checklist sits beside. */
  children?: React.ReactNode;
}

type TaskProgress = { completed: string[]; persistent: boolean };
type PanelState = "open" | "collapsed" | "dismissed";

// Stored as comma-separated task ids; unknown ids are ignored when counting.
function readProgress(key: string): TaskProgress {
  try {
    const stored = window.localStorage.getItem(key) ?? "";
    return { completed: stored.split(",").filter(Boolean), persistent: true };
  } catch {
    return { completed: [], persistent: false };
  }
}

// Fired by the header's checklist button so an open dashboard brings the card back at once.
const REOPEN_EVENT = "eduai:onboarding:reopen";

function storageKeyFor(platform: OnboardingPlatform, userId: string) {
  return `eduai:onboarding:v1:${platform}:${encodeURIComponent(userId)}`;
}

function readPanel(key: string): PanelState {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === "collapsed" || stored === "dismissed" ? stored : "open";
  } catch {
    return "open";
  }
}

function Checklist({ platform, role, userId, navigate, children }: ChecklistProps) {
  const storageKey = storageKeyFor(platform, userId);
  const panelKey = `${storageKey}:panel`;
  const tasks = onboardingTasks(platform, role);
  const [progress, setProgress] = React.useState<TaskProgress>({
    completed: [],
    persistent: true,
  });
  const [panel, setPanel] = React.useState<PanelState>("open");
  const [ready, setReady] = React.useState(false);
  const headingId = React.useId();
  const listId = React.useId();

  // Layout effect: a client navigation reads the saved state before paint, so a closed card
  // never reserves its column for a frame.
  React.useLayoutEffect(() => {
    setProgress(readProgress(storageKey));
    setPanel(readPanel(panelKey));
    setReady(true);
    const reopen = () => setPanel("open");
    window.addEventListener(REOPEN_EVENT, reopen);
    return () => window.removeEventListener(REOPEN_EVENT, reopen);
  }, [storageKey, panelKey]);

  const hidden = !ready || panel === "dismissed" || !userId || tasks.length === 0;
  const count = tasks.filter((task) => progress.completed.includes(task.id)).length;
  const collapsed = panel === "collapsed";

  function changePanel(next: PanelState) {
    try {
      window.localStorage.setItem(panelKey, next);
    } catch {
      // Still hide or collapse it for this visit when storage is blocked.
    }
    setPanel(next);
  }

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
    <div className="@container/onboarding">
      <div className="flex flex-col @2xl/onboarding:flex-row">
        {!hidden && (
          // A column beside the dashboard, top-aligned with its heading (#2070). It stacks above
          // only when the page itself is too narrow for two columns. It is not reserved before the
          // saved state is read, so a closed card never moves the dashboard; on a full page load
          // an open card appears after hydration.
          <div className="shrink-0 px-4 pt-6 lg:px-6 @2xl/onboarding:order-last @2xl/onboarding:w-80 @2xl/onboarding:pl-0">
            <section
              aria-labelledby={headingId}
              className="rounded-xl border bg-card text-card-foreground shadow-2xs"
            >
              <div className="p-4">
                <div className="flex items-baseline gap-2">
                  <h2
                    id={headingId}
                    className="text-xs font-semibold tracking-wider text-muted-foreground uppercase"
                  >
                    Getting started
                  </h2>
                  <p aria-live="polite" className="text-sm font-medium">
                    {count} of {tasks.length} done
                  </p>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Progress
                    value={(count / tasks.length) * 100}
                    aria-label="Getting started progress"
                    className="h-1.5 flex-1 bg-muted *:bg-primary-text"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    aria-expanded={!collapsed}
                    aria-controls={listId}
                    onClick={() => changePanel(collapsed ? "open" : "collapsed")}
                  >
                    {collapsed ? "Expand" : "Collapse"}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    aria-label="Close getting started"
                    title="Close getting started"
                    onClick={() => {
                      changePanel("dismissed");
                      toast(
                        "Getting started is hidden. Bring it back anytime with the checklist icon in the top bar.",
                        {
                          duration: 10_000,
                          position: "bottom-right",
                          closeButton: true,
                          // Close sits inside the top-right corner, where people look for it.
                          classNames: {
                            toast: "pr-10!",
                            closeButton:
                              "top-3! right-2! left-auto! size-7! transform-none! border-0! bg-transparent! [&>svg]:size-4!",
                          },
                        },
                      );
                    }}
                  >
                    <IconX aria-hidden />
                  </Button>
                </div>
              </div>
              {!collapsed && (
                <div id={listId} className="border-t px-4 pb-4">
                  <p className="pt-3 text-sm text-muted-foreground">
                    Open a task, then tick its circle when you have finished. For course tasks,
                    choose a course first.
                  </p>
                  <ul className="divide-y">
                    {tasks.map((task) => {
                      const done = progress.completed.includes(task.id);
                      return (
                        <li key={task.id} className="py-3">
                          <label className="flex cursor-pointer items-start gap-3 text-sm">
                            <input
                              type="checkbox"
                              checked={done}
                              onChange={() => toggle(task.id)}
                              className="peer sr-only"
                            />
                            {done ? (
                              <IconCircleCheckFilled
                                aria-hidden
                                className="size-5 shrink-0 rounded-full text-primary-text peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
                              />
                            ) : (
                              <IconCircle
                                aria-hidden
                                className="size-5 shrink-0 rounded-full text-muted-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
                              />
                            )}
                            <span
                              className={
                                done ? "text-muted-foreground line-through" : "font-medium"
                              }
                            >
                              {task.label}
                            </span>
                          </label>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-2 ml-8"
                            aria-label={`Open ${task.label}`}
                            onClick={() => navigate(task.href)}
                          >
                            Open
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                  <p
                    className="border-t pt-3 text-xs text-muted-foreground"
                    role={progress.persistent ? undefined : "status"}
                  >
                    {progress.persistent
                      ? "Progress is saved for your account in this browser only."
                      : "Progress cannot be saved in this browser. It lasts only while this page is open."}
                  </p>
                </div>
              )}
            </section>
          </div>
        )}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

export function OnboardingChecklist(props: ChecklistProps) {
  // Remount before showing a different account, including during client-side sign-in changes.
  return <Checklist key={`${props.platform}:${props.userId}`} {...props} />;
}

/** Header button that brings the Getting started card back after it was closed (#2070). */
export function GettingStartedButton({
  platform,
  role,
  userId,
  pathname,
  navigate,
}: Omit<ChecklistProps, "children"> & { pathname: string }) {
  if (!userId || onboardingTasks(platform, role).length === 0) return null;
  function reopen() {
    try {
      window.localStorage.setItem(`${storageKeyFor(platform, userId)}:panel`, "open");
    } catch {
      // The dashboard still reopens it for this visit through the event below.
    }
    window.dispatchEvent(new Event(REOPEN_EVENT));
    if (pathname !== "/dashboard") navigate("/dashboard");
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label="Show getting started checklist"
      title="Getting started checklist"
      onClick={reopen}
    >
      <IconChecklist className="size-4" aria-hidden />
    </Button>
  );
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
