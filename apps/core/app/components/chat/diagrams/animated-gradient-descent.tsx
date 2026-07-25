import { useId } from "react";
import { AnimatedDiagramShell } from "~/components/chat/diagrams/animated-diagram-shell";
import {
  StageChipButton,
  useDiagramStageUi,
} from "~/components/chat/diagrams/diagram-stage-ui";
import type { EduaiDiagramPayload } from "~/lib/ai/eduai-diagram-payload";
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
  payload: EduaiDiagramPayload;
}) {
  const { stages, selected, setSelected, detail } = useDiagramStageUi(
    "gradient-descent",
    payload,
  );
  const fillId = `gd-fill-${useId().replace(/:/g, "")}`;

  return (
    <AnimatedDiagramShell
      className={className}
      diagramId="gradient-descent"
      title={payload.title?.trim() || "Gradient descent — stepping downhill"}
      ariaLabel="Animated diagram of gradient descent stepping down a cost valley toward a minimum"
      caption="Each step moves opposite the gradient, walking downhill toward lower cost. Tap a stage for a short explanation."
      detail={detail}
    >
      {({ playKey, reducedMotion }) => (
        <div className="flex flex-col items-center gap-2">
          <GradientDescentSvg
            playKey={playKey}
            reducedMotion={reducedMotion}
            fillId={fillId}
            selected={selected}
            stageCount={stages.length}
          />
          <ol className="flex w-full flex-wrap items-stretch justify-center gap-1.5">
            {stages.map((stage, i) => (
              <li key={`${stage.label}-${i}`}>
                <StageChipButton
                  label={stage.label}
                  selected={selected === i}
                  onSelect={() => setSelected(i)}
                />
              </li>
            ))}
          </ol>
        </div>
      )}
    </AnimatedDiagramShell>
  );
}

const GD_MARKERS = [
  { cx: 70, cy: 48, delay: "0s" },
  { cx: 110, cy: 70, delay: "0.9s" },
  { cx: 140, cy: 110, delay: "1.8s" },
  { cx: 160, cy: 130, delay: "2.7s" },
] as const;

function GradientDescentSvg({
  playKey,
  reducedMotion,
  fillId,
  selected,
  stageCount,
}: {
  playKey: number;
  reducedMotion: boolean;
  fillId: string;
  selected: number;
  stageCount: number;
}) {
  const markerCount = Math.min(GD_MARKERS.length, Math.max(stageCount, 1));
  const markers = GD_MARKERS.slice(0, markerCount);
  const active = markers[Math.min(selected, markers.length - 1)] ?? markers[0]!;

  return (
    <svg
      key={playKey}
      viewBox="0 0 320 180"
      className="h-auto w-full max-w-md"
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
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
        fill={`url(#${fillId})`}
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
        {...(reducedMotion
          ? { cx: active.cx, cy: active.cy }
          : { cx: 70, cy: 48 })}
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

      {markers.map((p, i) => (
        <circle
          key={`${playKey}-step-${i}`}
          cx={p.cx}
          cy={p.cy}
          r={selected === i ? 5 : 3.5}
          className={selected === i ? "fill-primary" : "fill-primary/40"}
          opacity={reducedMotion ? (selected === i ? 1 : 0.35) : undefined}
        >
          {!reducedMotion && (
            <animate
              attributeName="opacity"
              values="0;1;1"
              keyTimes="0;0.15;1"
              dur="3.2s"
              begin={p.delay}
              fill="freeze"
            />
          )}
        </circle>
      ))}
    </svg>
  );
}
