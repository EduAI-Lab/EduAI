/**
 * Production chat transcript scroll-pane classes (#1320).
 * ChatConversationLayout and the visual overflow suite share this string so
 * reverting `overflow-x-hidden` here fails both.
 */
// No `scroll-smooth`: CSS smooth scrolling outranks a programmatic
// `behavior: "auto"`, which turned every streamed token into an animated crawl
// once useStickToBottom started following the bottom (#1517). The hook asks for
// smooth explicitly when it wants it (the jump-to-latest button).
export const CHAT_SCROLL_PANE_CLASS =
  "h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain scrollbar-hover";
