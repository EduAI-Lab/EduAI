/**
 * Catch-all route (`*`) for URLs that match nothing. Sits inside the `_app.tsx`
 * layout so an unknown path keeps the sidebar and header — see
 * `~/components/common/NotFoundState` for why every not-found case, including
 * "you may not open this", renders the same generic page.
 */
export { default } from "~/components/common/NotFoundState";
