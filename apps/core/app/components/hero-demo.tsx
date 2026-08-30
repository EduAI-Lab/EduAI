import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  IconClipboardText,
  IconFileText,
  IconMessages,
  IconRefresh,
  IconSparkles,
  IconCheck,
  IconLock,
  IconBooks,
} from "@tabler/icons-react";
import { cn } from "@eduai/ui";
import type { Icon } from "@tabler/icons-react";

import { useMotionReducedPreference } from "~/components/assistive/ui-preferences-provider";

/**
 * Hero demo reel — a scripted, non-interactive walkthrough of the three tools,
 * sitting beside the landing page title. Each scene plays its beats in, holds,
 * then animates out and hands off to the next tool.
 *
 * Nothing here talks to a server: the transcripts are canned illustrations of
 * flows the real apps ship, kept short enough to read in one pass. Under either
 * reduced-motion signal — the account preference or the OS setting — the reel
 * stops animating and becomes a plain tab panel with every beat already on
 * screen.
 */

/** A single step in a scene's script. */
interface Beat {
  /** Milliseconds to wait after the previous beat before this one appears. */
  delay: number;
  node: ReactNode;
}

interface Scene {
  id: string;
  /** Tab label. */
  app: string;
  /** Chrome subtitle — where in the app this flow lives. */
  context: string;
  icon: Icon;
  beats: Beat[];
  /** How long the finished scene stays on screen before it animates out. */
  hold: number;
}

const TYPE_SPEED_MS = 26;
const EXIT_MS = 420;

/**
 * Reduced motion for the reel = the account preference OR the OS setting.
 *
 * The landing page is public, so almost every viewer is signed out and their
 * account preference is the `false` default; honouring only that would leave a
 * visitor who has asked their OS for reduced motion watching an indefinitely
 * looping animation (WCAG 2.2.2). The OS half is read in an effect rather than
 * during render so the server and the first client render still agree.
 */
function useReelMotionReduced() {
  const accountReduced = useMotionReducedPreference();
  const [systemReduced, setSystemReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    setSystemReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setSystemReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return accountReduced || systemReduced;
}

/** Reveals `text` one character at a time once the beat it lives in is visible. */
function Typewriter({ text, className }: { text: string; className?: string }) {
  const motionReduced = useReelMotionReduced();
  const [count, setCount] = useState(motionReduced ? text.length : 0);

  useEffect(() => {
    if (motionReduced) {
      setCount(text.length);
      return;
    }
    setCount(0);
    // The tick counter lives outside the updater: clearing the interval from
    // inside a setState callback makes the updater impure, and React may call
    // it more than once per commit.
    let revealed = 0;
    const timer = window.setInterval(() => {
      revealed += 1;
      setCount(revealed);
      if (revealed >= text.length) window.clearInterval(timer);
    }, TYPE_SPEED_MS);
    return () => window.clearInterval(timer);
  }, [text, motionReduced]);

  const done = count >= text.length;

  return (
    <span className={className}>
      {text.slice(0, count)}
      {motionReduced || done ? null : (
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] animate-pulse bg-current"
        />
      )}
    </span>
  );
}

/** Chat bubble used by the EduAI and AI Tutor scenes. */
function Bubble({
  side,
  children,
  className,
}: {
  side: "user" | "assistant";
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex", side === "user" ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-[var(--radius-lg)] px-3 py-2 text-[13px] leading-relaxed",
          side === "user"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground dark:bg-background",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Citation chip — mirrors how grounded answers point back at course material. */
function SourceChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground">
      <IconFileText className="h-3 w-3 text-primary-text" />
      {label}
    </span>
  );
}

function ThinkingDots({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-text/60"
            style={{ animationDelay: `${dot * 120}ms` }}
          />
        ))}
      </span>
      {label}
    </div>
  );
}

/**
 * A chunk pulled out of the course material, shown the way a grounded answer
 * cites its evidence — the retrieval step made visible.
 */
function ExcerptCard({ source, quote }: { source: string; quote: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border border-l-2 border-l-primary/50 bg-muted/60 px-3 py-2 dark:bg-background">
      <div className="mb-1 flex items-center gap-1.5">
        <IconFileText className="h-3 w-3 shrink-0 text-primary-text" />
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {source}
        </span>
      </div>
      <p className="text-[12px] italic leading-relaxed text-foreground">{quote}</p>
    </div>
  );
}

/** Small caption used for status lines between the bigger beats. */
function StatusLine({
  icon: StatusIcon,
  children,
  tone = "muted",
}: {
  icon: Icon;
  children: ReactNode;
  tone?: "muted" | "accent";
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-[11px] font-medium",
        tone === "accent" ? "text-primary-text" : "text-muted-foreground",
      )}
    >
      <StatusIcon className="h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** Difficulty / taxonomy tag hung off a generated variant. */
function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground dark:bg-background">
      {children}
    </span>
  );
}

/**
 * Flips true `afterMs` after mount. Every beat in a scene mounts when the scene
 * starts, so these delays are measured from the top of the scene — the same
 * clock the beat delays use.
 */
function useDelayedFlag(afterMs: number) {
  const motionReduced = useReelMotionReduced();
  const [flipped, setFlipped] = useState(motionReduced);

  useEffect(() => {
    if (motionReduced) return;
    setFlipped(false);
    const timer = window.setTimeout(() => setFlipped(true), afterMs);
    return () => window.clearTimeout(timer);
  }, [afterMs, motionReduced]);

  return flipped;
}

/** Step counter with a filled track — the AI Tutor's progress through an activity. */
function StepProgress({
  step,
  total,
  advanceTo,
  advanceAfterMs = 0,
}: {
  step: number;
  total: number;
  /** Step to move to partway through the scene. */
  advanceTo?: number;
  advanceAfterMs?: number;
}) {
  const advanced = useDelayedFlag(advanceAfterMs);
  const current = advanced && advanceTo !== undefined ? advanceTo : step;

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium text-muted-foreground">
        Step {current} of {total}
      </span>
      <span aria-hidden="true" className="flex flex-1 gap-1">
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-500",
              index < current ? "bg-primary" : "bg-border",
            )}
          />
        ))}
      </span>
    </div>
  );
}

/** Chat option chips. One lights up as picked partway through the scene. */
function OptionRow({
  options,
  picked,
  pickAfterMs = 0,
}: {
  options: string[];
  /** Option that becomes selected once `pickAfterMs` has elapsed. */
  picked?: string;
  pickAfterMs?: number;
}) {
  const pickedYet = useDelayedFlag(pickAfterMs);
  const selected = pickedYet ? picked : undefined;

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {options.map((option) => (
        <span
          key={option}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
            option === selected
              ? "border-primary/50 bg-primary/10 text-primary-text"
              : "border-border bg-background text-muted-foreground",
          )}
        >
          {option === selected ? <IconCheck className="mr-1 inline h-3 w-3" /> : null}
          {option}
        </span>
      ))}
    </div>
  );
}

const scenes: Scene[] = [
  {
    id: "core",
    app: "EduAI",
    context: "Course chat · CHEM 121",
    icon: IconMessages,
    hold: 2200,
    beats: [
      {
        delay: 0,
        node: <StatusLine icon={IconBooks}>CHEM 121 · 42 course materials indexed</StatusLine>,
      },
      {
        delay: 300,
        node: (
          <Bubble side="user">
            <Typewriter text="Why is the rate law second order in NO?" />
          </Bubble>
        ),
      },
      { delay: 1300, node: <ThinkingDots label="Searching your course materials" /> },
      {
        delay: 800,
        node: (
          <Bubble side="assistant">
            The slow step in the mechanism your instructor gave collides two NO molecules, so the
            rate depends on [NO] twice over.
          </Bubble>
        ),
      },
      {
        delay: 600,
        node: (
          <ExcerptCard
            source="Lecture 8 — Kinetics, slide 14"
            quote={
              <>
                “Step 1 (slow): NO + NO → N<sub>2</sub>O<sub>2</sub> — both reactant molecules are
                NO.”
              </>
            }
          />
        ),
      },
      {
        delay: 500,
        node: (
          <div className="flex flex-wrap gap-1.5 pl-1">
            <SourceChip label="Lecture 8, slide 14" />
            <SourceChip label="Ch. 12 reading" />
            <SourceChip label="Lab 4 handout" />
          </div>
        ),
      },
      {
        delay: 800,
        node: (
          <Bubble side="user">
            <Typewriter text="Show me the rate expression." />
          </Bubble>
        ),
      },
      {
        delay: 1100,
        node: (
          <Bubble side="assistant">
            <span className="block">
              rate = k[NO]<sup>2</sup>[O<sub>2</sub>]
            </span>
            <span className="mt-1 block text-muted-foreground">
              k came from the Arrhenius fit your class did in lab 4.
            </span>
          </Bubble>
        ),
      },
      {
        delay: 600,
        node: (
          <StatusLine icon={IconLock}>
            Answered from this course only · UBC GPUs, nothing leaves campus
          </StatusLine>
        ),
      },
    ],
  },
  {
    id: "question-maker",
    app: "Question Maker",
    context: "Question bank · PHYS 111",
    icon: IconClipboardText,
    hold: 2600,
    beats: [
      {
        delay: 0,
        node: (
          <div className="rounded-[var(--radius-lg)] border border-border bg-muted/70 px-3 py-2 dark:bg-background">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Source question
            </p>
            <p className="text-[13px] leading-relaxed text-foreground">
              A 2.0 kg cart rolls at 3.0 m/s. What is its kinetic energy?
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              <Tag>Unit 2 · Energy</Tag>
              <Tag>Numeric</Tag>
              <Tag>Moderate</Tag>
            </div>
          </div>
        ),
      },
      {
        delay: 1000,
        node: (
          <StatusLine icon={IconRefresh} tone="accent">
            Generating 3 variants · keeping the concept, changing the numbers
          </StatusLine>
        ),
      },
      {
        delay: 800,
        node: (
          <VariantRow
            index={1}
            text="A 4.5 kg cart rolls at 1.8 m/s. Find its kinetic energy."
            tag="Same concept"
            answer="7.3 J"
          />
        ),
      },
      {
        delay: 420,
        node: (
          <VariantRow
            index={2}
            text="A cart with 16 J of kinetic energy moves at 4.0 m/s. Find its mass."
            tag="Solve in reverse"
            answer="2.0 kg"
          />
        ),
      },
      {
        delay: 420,
        node: (
          <VariantRow
            index={3}
            text="Two carts move at one speed; one has 3× the mass. Compare their energies."
            tag="Conceptual"
            answer="3× larger"
          />
        ),
      },
      {
        delay: 700,
        node: (
          <StatusLine icon={IconCheck} tone="accent">
            Answer keys drafted for all three
          </StatusLine>
        ),
      },
      {
        delay: 550,
        node: (
          <StatusLine icon={IconClipboardText}>
            Added to the PHYS 111 bank · 24 questions ready for the next problem set
          </StatusLine>
        ),
      },
    ],
  },
  {
    id: "ai-tutor",
    app: "AI Tutor",
    context: "Study buddy · Unit 3 practice",
    icon: IconSparkles,
    hold: 2200,
    beats: [
      { delay: 0, node: <StepProgress step={1} total={4} advanceTo={2} advanceAfterMs={5200} /> },
      {
        delay: 250,
        node: (
          <Bubble side="user">
            <Typewriter text="I'm stuck on question 4. What's the answer?" />
          </Bubble>
        ),
      },
      { delay: 1400, node: <ThinkingDots label="Checking where you are in Unit 3" /> },
      {
        delay: 800,
        node: (
          <Bubble side="assistant">
            Let's get there together. You already found the acceleration — what does Newton's second
            law let you do with it?
          </Bubble>
        ),
      },
      {
        delay: 750,
        node: (
          <OptionRow
            options={["Multiply by mass", "Divide by time", "Give me a hint"]}
            picked="Multiply by mass"
            pickAfterMs={4300}
          />
        ),
      },
      {
        delay: 1900,
        node: (
          <Bubble side="assistant">
            That's the one — F = ma. Your cart is 2.0 kg at 1.5 m/s², so what force does the problem
            want?
          </Bubble>
        ),
      },
      {
        delay: 900,
        node: (
          <Bubble side="user">
            <Typewriter text="3.0 N" />
          </Bubble>
        ),
      },
      {
        delay: 1000,
        node: (
          <Bubble side="assistant">
            Exactly. Same force, next step: it acts over 4.0 m, so how much work does it do?
          </Bubble>
        ),
      },
      {
        delay: 700,
        node: <StatusLine icon={IconSparkles}>Progress saved to your Unit 3 activity</StatusLine>,
      },
    ],
  },
];

function VariantRow({
  index,
  text,
  tag,
  answer,
}: {
  index: number;
  text: string;
  tag: string;
  answer: string;
}) {
  return (
    <div className="flex gap-2.5 rounded-[var(--radius-lg)] border border-border bg-background px-3 py-2">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary-text">
        {index}
      </span>
      <div>
        <p className="text-[13px] leading-relaxed text-foreground">{text}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Tag>{tag}</Tag>
          <span className="text-[11px] font-medium text-muted-foreground">Key: {answer}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Panel body. Every scene is rendered into the same grid cell, so the frame is
 * always as tall as the longest script and never resizes between scenes — the
 * scripts are written to land within a screenful of each other, so no scene is
 * cut off and none sits in an obviously empty box.
 *
 * Inactive scenes use `invisible` rather than unmounting: `visibility: hidden`
 * keeps their space (which is what makes the frame the max) while dropping them
 * out of the accessibility tree.
 */
function SceneBody({
  activeIndex,
  playCount,
  renderScene,
}: {
  activeIndex: number;
  /** Bumped every time a scene starts, so the playing scene remounts and its
   *  typewriters and in-place swaps run again on every loop. */
  playCount: number;
  renderScene: (scene: Scene, active: boolean) => ReactNode;
}) {
  return (
    <div className="grid px-4 py-4">
      {scenes.map((scene, index) => {
        const active = index === activeIndex;
        return (
          <div
            key={active ? `${scene.id}-${playCount}` : scene.id}
            className={cn(
              "col-start-1 row-start-1 space-y-2.5 self-start",
              active ? undefined : "invisible",
            )}
          >
            {renderScene(scene, active)}
          </div>
        );
      })}
    </div>
  );
}

/** Frame + tabs shared by the animated and reduced-motion renderings. */
function DemoFrame({
  scene,
  activeIndex,
  onSelect,
  children,
}: {
  scene: Scene;
  activeIndex: number;
  onSelect: (index: number) => void;
  children: ReactNode;
}) {
  const SceneIcon = scene.icon;

  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card shadow-xl shadow-primary/5">
        {/* Window chrome */}
        <div className="flex items-center gap-2.5 border-b border-border bg-muted/60 px-4 py-2.5 dark:bg-background/40">
          <span aria-hidden="true" className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-border" />
            <span className="h-2.5 w-2.5 rounded-full bg-border" />
            <span className="h-2.5 w-2.5 rounded-full bg-border" />
          </span>
          <SceneIcon className="ml-1 h-4 w-4 text-primary-text" />
          <span className="text-[12px] font-semibold text-foreground">{scene.app}</span>
          <span className="truncate text-[12px] text-muted-foreground">{scene.context}</span>
        </div>

        {children}
      </div>

      {/* Tabs */}
      <div className="mt-3 flex flex-wrap gap-2">
        {scenes.map((item, index) => {
          const active = index === activeIndex;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(index)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary/40 bg-primary/10 text-primary-text"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              {item.app}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function HeroDemo({ className }: { className?: string }) {
  const motionReduced = useReelMotionReduced();
  const [sceneIndex, setSceneIndex] = useState(0);
  const [replayToken, setReplayToken] = useState(0);
  const [visibleBeats, setVisibleBeats] = useState(motionReduced ? Infinity : 0);
  const [playCount, setPlayCount] = useState(0);
  const [exiting, setExiting] = useState(false);
  const timers = useRef<number[]>([]);

  const scene = scenes[sceneIndex];

  const clearTimers = () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  };

  useEffect(() => {
    if (motionReduced) return;

    clearTimers();
    setVisibleBeats(0);
    setExiting(false);
    // Remounts the playing scene so its typed lines start from empty again.
    setPlayCount((count) => count + 1);

    let elapsed = 0;
    scene.beats.forEach((beat, index) => {
      elapsed += beat.delay;
      timers.current.push(
        window.setTimeout(() => setVisibleBeats(index + 1), Math.max(elapsed, 30)),
      );
    });

    const exitAt = elapsed + scene.hold;
    timers.current.push(window.setTimeout(() => setExiting(true), exitAt));
    timers.current.push(
      window.setTimeout(() => {
        setSceneIndex((current) => (current + 1) % scenes.length);
      }, exitAt + EXIT_MS),
    );

    return clearTimers;
  }, [scene, replayToken, motionReduced]);

  // Unmounting mid-scene must not leave timers pointed at dead state.
  useEffect(() => clearTimers, []);

  /**
   * A tab jumps straight to that tool and replays it from the top; the reel
   * then carries on to the next scene on its own. `replayToken` re-runs the
   * scene effect when the picked scene is the one already playing.
   */
  const handleSelect = (index: number) => {
    clearTimers();
    setSceneIndex(index);
    setReplayToken((token) => token + 1);
  };

  if (motionReduced) {
    return (
      <div className={className}>
        <DemoFrame scene={scene} activeIndex={sceneIndex} onSelect={setSceneIndex}>
          <SceneBody
            activeIndex={sceneIndex}
            playCount={playCount}
            renderScene={(item) =>
              item.beats.map((beat, index) => <div key={`${item.id}-${index}`}>{beat.node}</div>)
            }
          />
        </DemoFrame>
      </div>
    );
  }

  return (
    <div className={className}>
      <DemoFrame scene={scene} activeIndex={sceneIndex} onSelect={handleSelect}>
        <SceneBody
          activeIndex={sceneIndex}
          playCount={playCount}
          renderScene={(item, active) => (
            <div
              className="space-y-2.5 will-change-transform"
              style={{
                opacity: active && exiting ? 0 : 1,
                transform: active && exiting ? "translateY(-10px) scale(0.985)" : "none",
                transition: `opacity ${EXIT_MS}ms ease-in, transform ${EXIT_MS}ms ease-in`,
              }}
            >
              {item.beats.map((beat, index) => {
                // Only the playing scene reveals beat by beat; the hidden ones
                // stay laid out in full so they keep holding the frame open.
                const shown = !active || index < visibleBeats;
                return (
                  <div
                    key={`${item.id}-${index}`}
                    className="will-change-transform"
                    style={{
                      opacity: shown ? 1 : 0,
                      transform: shown ? "none" : "translateY(10px)",
                      transition: "opacity 320ms ease-out, transform 320ms ease-out",
                    }}
                  >
                    {beat.node}
                  </div>
                );
              })}
            </div>
          )}
        />
      </DemoFrame>
    </div>
  );
}
