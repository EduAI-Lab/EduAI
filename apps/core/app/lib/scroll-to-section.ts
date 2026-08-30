/**
 * True when either the OS-level `prefers-reduced-motion` setting or the
 * account-level preference (mirrored onto <html> by UiPreferencesProvider) says
 * to stop animating. A smooth `scrollIntoView` overrides the CSS
 * `scroll-behavior` escape hatch in app.css, so the check has to be made here
 * too or that opt-out does nothing for exactly the links it was written for.
 */
function prefersReducedMotion() {
  if (document.documentElement.getAttribute("data-reduce-motion") === "true") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * The only part of the click this handler touches. Narrower than React's
 * `MouseEvent<HTMLAnchorElement>` (which satisfies it) so callers and tests do
 * not have to synthesize a whole synthetic event.
 */
type AnchorClick = { preventDefault: () => void };

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
export function scrollToSection(event: AnchorClick, href: string) {
  if (!href.startsWith("#")) return;

  const id = href.slice(1);
  const target = document.getElementById(id);
  if (!target) return;

  event.preventDefault();
  target.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "start",
  });
  // Carry the existing `history.state` across. React Router keeps its history
  // index, entry key and router state in there; replacing it with `null` makes
  // `getIndex()` return null (so the next push computes `null + 1`) and drops
  // the entry's key back to "default", which misfiles ScrollRestoration's
  // saved scroll positions.
  history.replaceState(history.state, "", href);
}
