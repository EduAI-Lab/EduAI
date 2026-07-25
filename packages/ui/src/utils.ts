import * as React from "react"
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Radix locks scrolling by setting `pointer-events: none` on <body> while an
 * overlay is open and clears it on close. When a Dialog/AlertDialog is opened
 * from a DropdownMenu (or another menu), the two layers' lock/unlock sequences
 * race during unmount and the body can be left frozen — every click after the
 * modal closes is swallowed. This hook restores interactivity on unmount, but
 * only once no other Radix overlay is still open, so stacked modals keep their
 * lock. Call it inside any portalled overlay content component.
 */
export function useRestoreBodyPointerEvents() {
  React.useEffect(() => {
    return () => {
      if (typeof document === "undefined") return
      // Defer to a microtask so the just-closed layer finishes its own cleanup
      // before we check whether anything else is still holding the lock.
      queueMicrotask(() => {
        const stillOpen = document.querySelector(
          '[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"], [data-state="open"][role="menu"]'
        )
        if (!stillOpen) document.body.style.pointerEvents = ""
      })
    }
  }, [])
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

// TEMPORARY probe for #1192 — verifies the patch-coverage reporter end-to-end.
// The empty-input branch is deliberately left unexercised so the report should
// show partial coverage and name that exact line. Reverted immediately after.
export function probeTitleCase(value: string): string {
  if (!value) {
    return "(empty)"
  }
  const head = value.charAt(0).toUpperCase()
  const tail = value.slice(1).toLowerCase()
  return `${head}${tail}`
}
