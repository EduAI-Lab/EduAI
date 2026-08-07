/**
 * Cross-app theme synchronization.
 *
 * The EduAI apps (Core, AI Tutor, Question Maker) run on different origins
 * (separate subdomains in prod, separate ports in dev), so neither
 * `localStorage` nor `BroadcastChannel` is shared between them — both are
 * origin-scoped. The durable cross-app channel is a COOKIE written at the shared
 * parent domain (the same domain the auth session uses via `COOKIE_DOMAIN` /
 * BetterAuth `crossSubDomainCookies`).
 *
 * Strategy:
 *  - Cookie (`eduai-theme`, scoped to `VITE_COOKIE_DOMAIN`) = cross-subdomain
 *    source of truth. Each app reads it on mount and applies it.
 *  - BroadcastChannel + `storage` events = instant same-origin propagation
 *    across tabs/windows of the same app.
 *  - `localStorage` (key `theme`, written by next-themes) = same-origin no-flash.
 *
 * NOTE: For cross-subdomain sync to work in a deployment, set `VITE_COOKIE_DOMAIN`
 * for each app to the shared parent domain (e.g. `.eduai.ok.ubc.ca`), mirroring
 * the server `COOKIE_DOMAIN`. Without it the cookie is host-only and sync falls
 * back to same-origin behaviour.
 */

export type Theme = "light" | "dark" | "system";

const BROADCAST_CHANNEL_NAME = "eduai_theme_sync";
const THEME_STORAGE_KEY = "theme";
const THEME_COOKIE_NAME = "eduai-theme";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

let broadcastChannel: BroadcastChannel | null = null;

function getCookieDomain(): string | undefined {
  // import.meta.env is available in the Vite-built apps that consume @eduai/ui.
  const domain = (import.meta as { env?: Record<string, string | undefined> }).env
    ?.VITE_COOKIE_DOMAIN;
  return domain?.trim() || undefined;
}

function readThemeCookie(): Theme | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${THEME_COOKIE_NAME}=`));
  if (!match) return null;
  const value = decodeURIComponent(match.split("=")[1] ?? "");
  return value === "light" || value === "dark" || value === "system" ? value : null;
}

function writeThemeCookie(theme: Theme): void {
  if (typeof document === "undefined") return;
  const domain = getCookieDomain();
  const parts = [
    `${THEME_COOKIE_NAME}=${encodeURIComponent(theme)}`,
    "path=/",
    `max-age=${COOKIE_MAX_AGE}`,
    "SameSite=Lax",
  ];
  if (domain) parts.push(`domain=${domain}`);
  if (typeof location !== "undefined" && location.protocol === "https:") {
    parts.push("Secure");
  }
  document.cookie = parts.join("; ");
}

/**
 * Initialize theme synchronization. Call once per app (after the theme provider
 * mounts). The callback receives a theme that originated from another app/tab so
 * the caller can apply it (e.g. next-themes `setTheme`).
 */
export function initThemeSync(onThemeChange?: (theme: Theme) => void): void {
  if (typeof window === "undefined") return;

  // Cross-subdomain: adopt the shared cookie on mount (set by another app).
  const cookieTheme = readThemeCookie();
  if (cookieTheme) {
    applyTheme(cookieTheme);
    onThemeChange?.(cookieTheme);
  }

  try {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    broadcastChannel.onmessage = (event) => {
      if (event.data?.type === "theme-changed") {
        const theme = event.data.theme as Theme;
        applyTheme(theme);
        onThemeChange?.(theme);
      }
    };
  } catch {
    // BroadcastChannel unsupported — fall back to storage events (same-origin).
    window.addEventListener("storage", (event) => {
      if (event.key === THEME_STORAGE_KEY && event.newValue) {
        const theme = event.newValue as Theme;
        applyTheme(theme);
        onThemeChange?.(theme);
      }
    });
  }
}

/**
 * Persist + propagate a theme change. Writes the shared cookie (cross-subdomain)
 * and broadcasts to same-origin tabs.
 */
export function broadcastThemeChange(theme: Theme): void {
  if (typeof window === "undefined") return;

  writeThemeCookie(theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage unavailable — cookie + broadcast still cover sync.
  }
  try {
    broadcastChannel?.postMessage({ type: "theme-changed", theme });
  } catch {
    // Broadcast unavailable — storage event / cookie still cover sync.
  }
}

/** Apply a theme to the document root (mirrors next-themes' class strategy). */
function applyTheme(theme: Theme): void {
  if (typeof window === "undefined") return;

  const html = document.documentElement;
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  html.classList.toggle("dark", isDark);
}

/** Close the broadcast channel (call on unmount if needed). */
export function closeThemeSync(): void {
  if (broadcastChannel) {
    broadcastChannel.close();
    broadcastChannel = null;
  }
}
