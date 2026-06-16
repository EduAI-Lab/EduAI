import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

export type PageTabsProps = React.ComponentProps<typeof TabsPrimitive.Root>
export type PageTabsListProps = React.ComponentProps<typeof TabsPrimitive.List>
export type PageTabsTriggerProps = React.ComponentProps<typeof TabsPrimitive.Trigger>
export type PageTabsContentProps = React.ComponentProps<typeof TabsPrimitive.Content>

export function PageTabs({ ...props }: PageTabsProps) {
  return <TabsPrimitive.Root {...props} />
}

export function PageTabsList({ className, ...props }: PageTabsListProps) {
  return (
    <TabsPrimitive.List
      className={`flex gap-0.5 border-b border-border mb-5 font-sans${className ? ` ${className}` : ""}`}
      {...props}
    />
  )
}

export function PageTabsTrigger({ className, ...props }: PageTabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={[
        // layout + base typography
        "flex items-center gap-1.5 px-3.5 py-2 text-sm font-normal whitespace-nowrap",
        // color + background
        "text-muted-foreground bg-transparent",
        // underline indicator (bottom border only, flush with strip border)
        "border-b-2 border-transparent -mb-px",
        // top corner rounding matches design system --radius-sm
        "rounded-t-[var(--radius-sm)]",
        // cursor + interaction
        "cursor-pointer outline-none",
        // smooth transition (matches Tabs.jsx: 150ms ease)
        "transition-[color,border-color] duration-150 ease-in-out",
        // hover: nudge inactive tabs toward foreground
        "hover:text-foreground",
        // active (mouse-down) feedback
        "active:opacity-75",
        // active tab state
        "data-[state=active]:font-semibold data-[state=active]:text-secondary data-[state=active]:border-secondary",
        // active + hover: keep secondary color (prevents hover:text-foreground from winning)
        "data-[state=active]:hover:text-secondary",
        // keyboard focus ring
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:rounded-sm",
        // disabled
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      ].filter(Boolean).join(" ")}
      {...props}
    />
  )
}

export function PageTabsContent({ className, ...props }: PageTabsContentProps) {
  return (
    <TabsPrimitive.Content
      className={`outline-none${className ? ` ${className}` : ""}`}
      {...props}
    />
  )
}
