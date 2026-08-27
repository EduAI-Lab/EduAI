import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How close to the bottom (px) still counts as "following the conversation".
 * Big enough to survive sub-pixel rounding and a partially rendered last line,
 * small enough that a deliberate scroll up unpins immediately.
 */
export const STICK_TO_BOTTOM_THRESHOLD_PX = 48;

type ScrollMetrics = Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">;

/**
 * The rendered transcript, identified only by message identity — that is all
 * the hook needs to know a render may have changed the pane's height.
 */
export type TranscriptRevision = readonly { readonly id: string }[];

/** Whether the pane is scrolled to (or within the threshold of) its bottom. */
export function isScrolledToBottom(
  pane: ScrollMetrics,
  threshold: number = STICK_TO_BOTTOM_THRESHOLD_PX,
): boolean {
  return pane.scrollHeight - pane.scrollTop - pane.clientHeight <= threshold;
}

/**
 * Keeps a scroll pane pinned to its newest content (#1517).
 *
 * The transcript pane had no auto-scroll at all, so every reply streamed in
 * below the fold and had to be chased manually. This follows the bottom while
 * the reader is already there, and stops the moment they scroll up to re-read
 * something — surfacing a "jump to latest" affordance instead of yanking them
 * back down mid-sentence.
 *
 * Growth is observed on the content element rather than inferred from the
 * message list: a streaming reply mutates one message's text, so the list is
 * not a reliable signal that the pane actually got taller.
 */
export function useStickToBottom<Pane extends HTMLElement, Content extends HTMLElement>(
  transcript: TranscriptRevision,
) {
  const paneRef = useRef<Pane | null>(null);
  const contentRef = useRef<Content | null>(null);
  // Mirrored in a ref so the scroll/resize listeners read the current value
  // without being torn down and rebuilt on every pin change.
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);

  const setPinnedState = useCallback((next: boolean) => {
    pinnedRef.current = next;
    setPinned((current) => (current === next ? current : next));
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const pane = paneRef.current;
      if (!pane) return;
      setPinnedState(true);
      if (typeof pane.scrollTo === "function") {
        pane.scrollTo({ top: pane.scrollHeight, behavior });
      } else {
        // happy-dom and older engines expose scrollTop but not scrollTo.
        pane.scrollTop = pane.scrollHeight;
      }
    },
    [setPinnedState],
  );

  // Unpin when the reader scrolls away from the bottom; re-pin when they return.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;

    const handleScroll = () => setPinnedState(isScrolledToBottom(pane));
    pane.addEventListener("scroll", handleScroll, { passive: true });
    return () => pane.removeEventListener("scroll", handleScroll);
  }, [setPinnedState]);

  // Follow content growth while pinned. `transcript` covers renders that
  // replace the pane's children outright (a transcript loading in, a new
  // message appended); the observer covers token-by-token growth within one
  // message, which does not always change the array identity.
  useEffect(() => {
    if (pinnedRef.current) scrollToBottom("auto");
  }, [transcript, scrollToBottom]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) scrollToBottom("auto");
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  return { paneRef, contentRef, pinned, scrollToBottom };
}
