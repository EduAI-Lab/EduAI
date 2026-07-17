import { useEffect, useState } from "react";
import { AnimatedDiagramShell } from "~/components/chat/diagrams/animated-diagram-shell";
import {
  defaultStagesForType,
  normalizeStagesForType,
  type EduaiDiagramPayload,
} from "~/lib/ai/eduai-diagram-payload";
import { cn } from "~/lib/utils";

/**
 * Curated SVG animation: a point steps downhill on a cost valley.
 * Stage chips (from payload) stay tappable for Assist ladder/TLDR parity.
 */
export function AnimatedGradientDescent({
  className,
  payload,
}: {
  className?: string;
  payload?: EduaiDiagramPayload;
}) {
  const stages = normalizeStagesForType(
    "gradient-descent",
    payload?.stages && payload.stages.length > 0
      ? payload.stages
      : defaultStagesForType("gradient-descent"),
  );
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    setSelected(0);
  }, [payload?.title, stages.map((s) => s.label).join("|")]);

  return (
    <AnimatedDiagramShell
      className={className}
      diagramId="gradient-descent"
      title={payload?.title?.trim() || "Gradient descent — stepping downhill"}
      ariaLabel="Animated diagram of gradient descent stepping down a cost valley toward a minimum"
      caption="Each step moves opposite the gradient, walking downhill toward lower cost. Tap a stage for a short explanation."
      detail={
        <>
          <span className="font-medium">{stages[selected]?.label}</span>
          {stages[selected]?.detail ? (
            <span className="text-muted-foreground">
              {" — "}
              {stages[selected]?.detail}
            </span>
          ) : null}
        </>
      }
    >
      {({ playKey, reducedMotion }) => (
        <div className="flex flex-col items-center gap-2">
          <GradientDescentSvg playKey={playKey} reducedMotion={reducedMotion} />
          <ol className="flex w-full flex-wrap items-stretch justify-center gap-1.5">
            {stages.map((stage, i) => (
              <li key={`${stage.label}-${i}`}>
                <button
                  type="button"
                  onClick={() => setSelected(i)}
                  aria-pressed={selected === i}
                  className={cn(
                    "min-h-11 min-w-[4.5rem] max-w-[7.5rem] rounded-lg border px-2 py-2 text-center text-[11px] font-medium leading-snug transition-colors sm:text-xs",
                    selected === i
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-muted/60",
                  )}
                >
                  {stage.label}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </AnimatedDiagramShell>
  );
}

function GradientDescentSvg({
  playKey,
  reducedMotion,
}: {
  playKey: number;
  reducedMotion: boolean;
}) {
  return (
    <svg
      key={playKey}
      viewBox="0 0 320 180"
      className="h-auto w-full max-w-md"
    >
      <defs>
        <linearGradient id="gd-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.08" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      <line
        x1="36"
        y1="20"
        x2="36"
        y2="150"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1.5"
      />
      <line
        x1="36"
        y1="150"
        x2="300"
        y2="150"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1.5"
      />
      <text x="28" y="18" textAnchor="end" className="fill-muted-foreground text-[10px]">
        cost
      </text>
      <text x="300" y="166" textAnchor="end" className="fill-muted-foreground text-[10px]">
        params
      </text>

      <path
        d="M 50 40 Q 120 40 160 130 Q 200 40 270 40"
        fill="url(#gd-fill)"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="2"
      />

      <text x="168" y="148" textAnchor="middle" className="fill-muted-foreground text-[9px]">
        minimum
      </text>

      <circle
        r="7"
        className={cn("fill-primary stroke-background")}
        {...(reducedMotion ? { cx: 160, cy: 130 } : { cx: 70, cy: 48 })}
      >
        {!reducedMotion && (
          <animateMotion
            key={playKey}
            dur="3.2s"
            fill="freeze"
            path="M 70 48 Q 110 55 130 90 Q 145 115 160 130"
            calcMode="spline"
            keyTimes="0;1"
            keySplines="0.4 0 0.2 1"
          />
        )}
      </circle>

      {!reducedMotion &&
        [
          { cx: 70, cy: 48, delay: "0s" },
          { cx: 110, cy: 70, delay: "0.9s" },
          { cx: 140, cy: 110, delay: "1.8s" },
          { cx: 160, cy: 130, delay: "2.7s" },
        ].map((p, i) => (
          <circle
            key={`${playKey}-step-${i}`}
            cx={p.cx}
            cy={p.cy}
            r="3.5"
            className="fill-primary/40"
            opacity="0"
          >
            <animate
              attributeName="opacity"
              values="0;1;1"
              keyTimes="0;0.15;1"
              dur="3.2s"
              begin={p.delay}
              fill="freeze"
            />
          </circle>
        ))}
    </svg>
  );
}
