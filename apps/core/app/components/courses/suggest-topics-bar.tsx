import { IconSparkles } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@eduai/ui";

type SuggestTopicsBarProps = {
  /** Processed materials with no accepted topic. */
  unfiledMaterials: number;
  /** A topic job is already running; asking again would only wait for it. */
  busy: boolean;
  onSuggest: () => Promise<void>;
};

/**
 * The Topics tab's on-demand **Suggest topics** action (#1966).
 *
 * EduAI never proposes topics by itself any more; this is the one way to ask.
 * The run reads the whole course and proposes only what its topics are
 * missing, and its progress and outcome show in the banner below.
 */
export function SuggestTopicsBar({ unfiledMaterials, busy, onSuggest }: SuggestTopicsBarProps) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setStarting(true);
    setError(null);
    try {
      await onSuggest();
    } catch (e) {
      setError(
        e instanceof Error && e.message.includes("NO_ANALYZABLE_MATERIALS")
          ? "Upload some course materials first. Suggestions are based on them."
          : "Couldn't start suggesting topics. Please try again.",
      );
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2.5">
      <div className="text-sm">
        <p className="font-medium">Suggest topics from your materials</p>
        <p className="text-xs text-muted-foreground">
          {unfiledMaterials > 0
            ? `${unfiledMaterials} ${unfiledMaterials === 1 ? "file has" : "files have"} no topic yet. `
            : ""}
          EduAI reads the whole course and suggests only topics it&rsquo;s missing, for you to
          approve.
        </p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void handleClick()}
        disabled={busy || starting}
      >
        <IconSparkles className="mr-1.5 h-4 w-4" />
        {busy ? "Working…" : starting ? "Starting…" : "Suggest topics"}
      </Button>
    </div>
  );
}
