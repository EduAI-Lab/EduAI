import { useEffect, useRef } from "react"
import { initThemeSync, closeThemeSync, broadcastThemeChange } from "./lib/theme-sync"
import { useTheme } from "./theme-provider"

/**
 * Initialize cross-app theme synchronization. Must be wrapped in `ThemeProvider`.
 *
 * Shared version of the `ThemeSyncInitializer` that used to be copy-pasted
 * near-identically into each app (Core, AI Tutor, Question Maker). All three
 * copies were behaviorally identical — same ref-pinning pattern, same
 * mount-once init, same broadcast-on-change effect — and differed only
 * cosmetically: quote/semicolon style, an app-specific JSDoc blurb, and a
 * `"use client"` pragma in the two Next.js apps (Core, AI Tutor; Question
 * Maker is a Vite SPA and had none). This component intentionally omits
 * `"use client"`: no other hook-using component in this package carries it
 * (see `ThemeToggle`, which also calls `useTheme`), so Next.js consumers add
 * the pragma at their own call site, same as they already do for every other
 * `@eduai/ui` component. No other divergence existed to reconcile.
 */
export function ThemeSyncInitializer() {
  const { setTheme, theme } = useTheme()

  // Refs so the initThemeSync callback always sees the *current* theme/setTheme
  // without listing them as effect deps. This matters because next-themes'
  // `setTheme` is NOT referentially stable — it is `useCallback(..., [theme])`,
  // so its identity changes on every toggle. Depending on it (or on `theme`)
  // would re-run the init effect each toggle, which re-reads the (stale) theme
  // cookie and calls setTheme → an infinite "Maximum update depth" ping-pong
  // that rapidly flips dark/light. Pinning both in refs lets the effect run
  // exactly once on mount.
  const themeRef = useRef(theme)
  const setThemeRef = useRef(setTheme)

  useEffect(() => {
    themeRef.current = theme
    setThemeRef.current = setTheme
  })

  // Initialize cross-app sync exactly once. Empty deps are intentional — see above.
  useEffect(() => {
    initThemeSync((newTheme) => {
      if (newTheme !== themeRef.current) {
        setThemeRef.current(newTheme)
      }
    })

    return () => {
      closeThemeSync()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Broadcast theme changes to other apps
  useEffect(() => {
    if (theme && (theme === "dark" || theme === "light" || theme === "system")) {
      broadcastThemeChange(theme)
    }
  }, [theme])

  return null
}
