import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How close to the bottom (px) still counts as "following the conversation".
 * Big enough to survive sub-pixel rounding and a partially rendered last line,
 * small enough that a deliberate scroll up unpins immediately.
 */
export const STICK_TO_BOTTOM_THRESHOLD_PX = 48;

/**
 * Fallback release for the programmatic-scroll latch, for engines without
 * `scrollend`. Comfortably longer than a native smooth scroll of one pane.
 */
const SMOOTH_SCROLL_MAX_MS = 1000;

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
 * Growth is followed from two directions. The transcript array is a new
 * identity on every streamed update, so a render-driven effect catches token
 * growth; a ResizeObserver on the content element catches the height changes
 * that land outside a render — markdown, diagrams, code blocks and images
 * settling after their first paint.
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
  // Latched while a programmatic smooth scroll animates, so its per-frame
  // scroll events are not mistaken for the reader scrolling away.
  const smoothScrollingRef = useRef(false);
  const smoothScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPinnedState = useCallback((next: boolean) => {
    pinnedRef.current = next;
    setPinned((current) => (current === next ? current : next));
  }, []);

  const endSmoothScroll = useCallback(() => {
    if (!smoothScrollingRef.current) return;
    smoothScrollingRef.current = false;
    if (smoothScrollTimerRef.current) {
      clearTimeout(smoothScrollTimerRef.current);
      smoothScrollTimerRef.current = null;
    }
    // Settle on where the pane actually ended up: at the bottom if the
    // animation completed, wherever the reader interrupted it if not.
    const pane = paneRef.current;
    if (pane) setPinnedState(isScrolledToBottom(pane));
  }, [setPinnedState]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const pane = paneRef.current;
      if (!pane) return;
      setPinnedState(true);
      if (typeof pane.scrollTo === "function") {
        if (behavior === "smooth") {
          smoothScrollingRef.current = true;
          if (smoothScrollTimerRef.current) clearTimeout(smoothScrollTimerRef.current);
          // `scrollend` is not everywhere yet; release the latch on a timer too
          // so a browser without it cannot strand the pane in pinned state.
          smoothScrollTimerRef.current = setTimeout(endSmoothScroll, SMOOTH_SCROLL_MAX_MS);
        }
        pane.scrollTo({ top: pane.scrollHeight, behavior });
      } else {
        // happy-dom and older engines expose scrollTop but not scrollTo.
        pane.scrollTop = pane.scrollHeight;
      }
    },
    [endSmoothScroll, setPinnedState],
  );

  useEffect(
    () => () => {
      if (smoothScrollTimerRef.current) clearTimeout(smoothScrollTimerRef.current);
    },
    [],
  );

  // Unpin when the reader scrolls away from the bottom; re-pin when they return.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;

    const handleScroll = () => {
      // The jump button's smooth scroll emits a scroll event per animation
      // frame, every one of them still short of the bottom. Reading those as
      // the reader scrolling would unpin the pane — and flicker the button
      // back into view — until the final frame landed.
      if (smoothScrollingRef.current) return;
      setPinnedState(isScrolledToBottom(pane));
    };
    pane.addEventListener("scroll", handleScroll, { passive: true });
    pane.addEventListener("scrollend", endSmoothScroll);
    return () => {
      pane.removeEventListener("scroll", handleScroll);
      pane.removeEventListener("scrollend", endSmoothScroll);
    };
  }, [endSmoothScroll, setPinnedState]);

  // Follow content growth while pinned. `transcript` covers everything React
  // renders — including token-by-token growth, since each streamed update
  // hands down a new array — and the observer below covers the height changes
  // that happen without a render.
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
