import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@eduai/ui";
import { IconPlayerPlay } from "@tabler/icons-react";
import { cn } from "~/lib/utils";

type AnimatedDiagramShellProps = {
  title: string;
  diagramId: string;
  ariaLabel: string;
  className?: string;
  caption?: string;
  /** Detail panel under the diagram (e.g. selected stage explanation). */
  detail?: ReactNode;
  children: (ctx: {
    playKey: number;
    reducedMotion: boolean;
  }) => ReactNode;
};

/** Shared chrome: title, Replay, reduced-motion detection. */
export function AnimatedDiagramShell({
  title,
  diagramId,
  ariaLabel,
  className,
  caption,
  detail,
  children,
}: AnimatedDiagramShellProps) {
  const [playKey, setPlayKey] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return (
    <div
      className={cn(
        // #1320: w-full + min-w-0 so this shell shrinks to its message-column
        // parent instead of growing to fit an unwrapped flex-wrap row of
        // stage chips (flex items default to min-width: auto, which lets
        // their content's intrinsic width push an ancestor wider than the
        // viewport instead of wrapping).
        "my-3 w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-border/60 bg-muted/30 p-3",
        className,
      )}
      data-eduai-diagram={diagramId}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        {!reducedMotion && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setPlayKey((k) => k + 1)}
            aria-label="Replay animation"
          >
            <IconPlayerPlay className="h-3.5 w-3.5" />
            Replay
          </Button>
        )}
      </div>
      <div role="group" aria-label={ariaLabel} className="min-w-0">
        {children({ playKey, reducedMotion })}
      </div>
      {detail ? (
        <div className="mt-2 rounded-lg border border-border/50 bg-background/70 px-3 py-2 text-sm text-foreground">
          {detail}
        </div>
      ) : null}
      {caption ? (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{caption}</p>
      ) : null}
    </div>
  );
}
