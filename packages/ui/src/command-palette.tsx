/**
 * Global ⌘K command palette, shared across Core, QuestionMaker, and AI Tutor
 * (issue #764). Data-driven: the host app passes groups of items (navigation,
 * course switching, actions) and the palette renders + filters + wires ⌘K and an
 * optional window "open" event identically everywhere. The matching header search
 * button (`CommandSearchButton`) dispatches that same event.
 */
import * as React from "react"
import { IconSearch } from "@tabler/icons-react"

import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "./ui/command"
import { visibleAppsForRole, type LauncherApp } from "./app-launcher"
import { cn } from "./utils"

export interface CommandPaletteItem {
  icon?: React.ReactNode
  label: string
  /** Secondary muted text shown after the label. */
  sublabel?: string
  /** Keyboard hint chip on the right (e.g. "C"). */
  shortcut?: string
  /** cmdk match string; defaults to the label. Use to make an item searchable by code/name. */
  value?: string
  onSelect: () => void
}

export interface CommandPaletteGroup {
  heading?: string
  items: CommandPaletteItem[]
}

/**
 * Build a "Switch app" palette group from the shared launcher app list — jump
 * between EduAI apps (Core, AI Tutor, Question Maker) straight from ⌘K. RBAC-gated
 * via each app's `roles`, and the current app is dropped. Apps live on different
 * origins, so selecting one navigates with a full-page load. Shared so all three
 * palettes offer the identical switcher.
 */
export function buildAppSwitcherGroup(opts: {
  apps: LauncherApp[]
  currentAppId: string
  role?: string | null
  heading?: string
}): CommandPaletteGroup {
  const { apps, currentAppId, role, heading = "Switch app" } = opts
  const items: CommandPaletteItem[] = visibleAppsForRole(apps, role)
    .filter((app) => app.id !== currentAppId)
    .map((app) => ({
      label: app.name,
      sublabel: app.description,
      value: `app ${app.name}`,
      icon: app.icon,
      onSelect: () => {
        if (typeof window !== "undefined") window.location.href = app.url
      },
    }))
  return { heading, items }
}

export interface CommandPaletteProps {
  groups: CommandPaletteGroup[]
  placeholder?: string
  emptyText?: string
  /** Window event name that also opens the palette (dispatched by CommandSearchButton). */
  openEventName?: string
  /** Fires on every open/close — use to lazily load data (e.g. courses) on first open. */
  onOpenChange?: (open: boolean) => void
  /**
   * Fires on every keystroke in the search box (#1143). Providing it switches
   * the palette to host-driven results: cmdk's own filtering is turned off, so
   * the host must narrow `groups` by the query itself. Needed when a group is
   * server-paginated — cmdk can only filter the rows already loaded, which for
   * a paged list is just the first page.
   */
  onQueryChange?: (query: string) => void
}

export function CommandPalette({
  groups,
  placeholder = "Search or jump to…",
  emptyText = "No results found.",
  openEventName,
  onOpenChange,
  onQueryChange,
}: CommandPaletteProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const hostFiltered = Boolean(onQueryChange)

  // Fire onOpenChange from an effect keyed on `open`, not from inside the state
  // updater — an impure updater double-fires under React 18 StrictMode. Skip the
  // initial mount so it only signals real open/close transitions. The latest
  // callback is held in a ref so the effect stays keyed purely on `open`.
  const onOpenChangeRef = React.useRef(onOpenChange)
  React.useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  })
  const firstRender = React.useRef(true)
  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    onOpenChangeRef.current?.(open)
  }, [open])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener("keydown", onKey)
    let onOpen: (() => void) | undefined
    if (openEventName) {
      onOpen = () => setOpen(true)
      window.addEventListener(openEventName, onOpen)
    }
    return () => {
      document.removeEventListener("keydown", onKey)
      if (openEventName && onOpen) window.removeEventListener(openEventName, onOpen)
    }
  }, [openEventName])

  // Reset the query on close so the next open starts from the full list rather
  // than the previous search's narrowed results.
  React.useEffect(() => {
    if (!open && hostFiltered && query !== "") {
      setQuery("")
      onQueryChange?.("")
    }
    // `onQueryChange` is intentionally omitted: this must fire on close, not
    // when the host happens to pass a new callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hostFiltered])

  const run = (fn: () => void) => {
    setOpen(false)
    fn()
  }

  // Groups with no items are dropped so empty sections never render a heading.
  const visible = groups.filter((g) => g.items.length > 0)

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      shouldFilter={hostFiltered ? false : undefined}
    >
      <CommandInput
        placeholder={placeholder}
        {...(hostFiltered
          ? {
              value: query,
              onValueChange: (value: string) => {
                setQuery(value)
                onQueryChange?.(value)
              },
            }
          : {})}
      />
      <CommandList>
        <CommandEmpty>{emptyText}</CommandEmpty>
        {visible.map((group, gi) => (
          <React.Fragment key={group.heading ?? gi}>
            {gi > 0 && <CommandSeparator />}
            <CommandGroup heading={group.heading}>
              {group.items.map((item, ii) => (
                <CommandItem
                  key={`${item.label}-${ii}`}
                  value={item.value ?? item.label}
                  onSelect={() => run(item.onSelect)}
                >
                  {item.icon}
                  <span className="font-medium">{item.label}</span>
                  {item.sublabel && (
                    <span className="truncate text-muted-foreground">{item.sublabel}</span>
                  )}
                  {item.shortcut && <CommandShortcut>{item.shortcut}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          </React.Fragment>
        ))}
      </CommandList>
    </CommandDialog>
  )
}

export interface CommandSearchButtonProps {
  /** Called on click; if omitted, dispatches `eventName` on window. */
  onOpen?: () => void
  eventName?: string
  label?: string
  className?: string
}

/** Header trigger for the command palette — matches the shared palette's look. */
export function CommandSearchButton({
  onOpen,
  eventName,
  label = "Search",
  className,
}: CommandSearchButtonProps) {
  const shortcut = useShortcutLabel()
  const handle = () => {
    if (onOpen) onOpen()
    else if (eventName) window.dispatchEvent(new CustomEvent(eventName))
  }
  return (
    <button
      type="button"
      onClick={handle}
      aria-label="Open command palette"
      className={cn(
        "flex h-9 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-sm text-muted-foreground shadow-sm transition-colors hover:bg-muted",
        className,
      )}
    >
      <IconSearch className="size-3.5" />
      <span className="hidden sm:inline">{label}</span>
      <kbd className="ml-1 hidden items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium sm:inline-flex">
        {shortcut}
      </kbd>
    </button>
  )
}

/**
 * The ⌘K / Ctrl K label for the current platform. Defaults to the mac glyph so
 * the SSR markup and the first client render match (no hydration mismatch), then
 * corrects to "Ctrl K" on non-Apple platforms after mount.
 */
function useShortcutLabel(): string {
  const [isMac, setIsMac] = React.useState(true)
  React.useEffect(() => {
    const p =
      (typeof navigator !== "undefined" &&
        ((navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ||
          navigator.platform ||
          navigator.userAgent)) ||
      ""
    setIsMac(/Mac|iPhone|iPad|iPod/i.test(p))
  }, [])
  return isMac ? "⌘K" : "Ctrl K"
}
