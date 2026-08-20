/**
 * Production chat transcript scroll-pane classes (#1320).
 * ChatConversationLayout and the visual overflow suite share this string so
 * reverting `overflow-x-hidden` here fails both.
 */
export const CHAT_SCROLL_PANE_CLASS =
  "h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain scrollbar-hover scroll-smooth";
