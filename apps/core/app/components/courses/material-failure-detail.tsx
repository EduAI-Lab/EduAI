import { IconHelpCircle, IconRefresh } from "@tabler/icons-react";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@eduai/ui";

import type { MaterialFailureNotice } from "~/lib/material-failure-notice";

export interface MaterialFailureDetailProps {
  notice: MaterialFailureNotice;
  /**
   * Re-runs indexing from the text already stored server-side. Omitted where
   * the caller cannot retry; the control is also hidden for any notice whose
   * `canRetry` is false, so a retry is never offered where it cannot work.
   */
  onRetry?: () => void;
  /** A retry for this material is already in flight. */
  retrying?: boolean;
  /**
   * Why the last retry did not happen, if one was refused. Shown beside the
   * button rather than swallowed: `reprocessMaterial` throws on any non-2xx,
   * and without this the instructor saw the button reset and nothing else.
   */
  retryError?: string | null;
}

/**
 * The `(?)` beside a failed material's badge (#1749).
 *
 * The badge on its own said only "Failed", which left re-uploading the file as
 * the only thing an instructor could try — even when the file was fine and the
 * upload had simply landed while the embedding provider was down. The reason
 * lives behind a disclosure rather than in the row, because most rows are not
 * failed and the list is meant to be scannable.
 *
 * "Try again" appears only when the notice says a retry can succeed. An
 * extraction failure has neither text nor bytes left to re-run from
 * (`failMaterial` discards the upload blob), and a duplicate receipt would
 * only reach the same conclusion again — offering a button in either case
 * would just be a slower way to reach the same dead end.
 */
export function MaterialFailureDetail({
  notice,
  onRetry,
  retrying = false,
  retryError = null,
}: MaterialFailureDetailProps) {
  const canRetry = notice.canRetry && onRetry !== undefined;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Why did this fail?"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
        >
          <IconHelpCircle className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2 text-left">
        <p className="text-[13px] font-medium text-foreground">{notice.title}</p>
        <p className="text-[12px] leading-relaxed text-muted-foreground">{notice.description}</p>
        {canRetry && (
          <>
            {retryError && (
              // Left clickable behind this: a provider that was down a moment
              // ago is exactly the case the retry exists for.
              <p role="alert" className="text-[12px] leading-relaxed text-destructive">
                {retryError}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetry}
              disabled={retrying}
              className="w-full"
            >
              <IconRefresh className="h-3.5 w-3.5" />
              {retrying ? "Retrying…" : "Try again"}
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
