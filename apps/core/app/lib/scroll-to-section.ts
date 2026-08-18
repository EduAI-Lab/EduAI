import type { MouseEvent } from "react";

/**
 * Handles clicks on in-page `#section` anchors on the landing page.
 *
 * A plain `<a href="#id">` needed two clicks to actually scroll: React
 * Router's `<ScrollRestoration>` resets the viewport on the history entry the
 * browser's native anchor jump just created, so the first click's scroll was
 * immediately undone and only a second click (hash unchanged, no new history
 * entry, nothing for ScrollRestoration to reset) stuck. Scrolling explicitly
 * and skipping the hash-driven history push avoids the race.
 */
export function scrollToSection(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (!href.startsWith("#")) return;

  const id = href.slice(1);
  const target = document.getElementById(id);
  if (!target) return;

  event.preventDefault();
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  history.replaceState(null, "", href);
}
