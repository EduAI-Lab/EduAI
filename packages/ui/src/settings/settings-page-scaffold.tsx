import * as React from "react"

import { PageHeading } from "../page-heading"
import { PageTabs, PageTabsContent, PageTabsList, PageTabsTrigger } from "../page-tabs"

/**
 * The 3 observed outer-wrapper variants across the settings pages, mirroring
 * `DetailPageScaffold`. Core and QM previously nested four wrapper divs and
 * repeated `px-4 lg:px-6` per section; ai-tutor already used the flat form,
 * which is what every app gets here.
 */
const PADDING_CLASSES = {
  none: "flex flex-col gap-8",
  qm: "@container/main flex flex-1 flex-col gap-8 px-4 py-4 md:py-6 lg:px-6",
  app: "@container/main flex flex-1 flex-col gap-8 px-4 pt-6 pb-8 lg:px-6",
} as const

export interface SettingsTab {
  /** Kebab-case tab id, e.g. "api-keys". */
  value: string
  label: string
  /** Tabler icon rendered at `h-4 w-4` in the trigger. */
  icon?: React.ReactNode
  content: React.ReactNode
  /**
   * Wraps just the trigger — Core puts its Canvas tab inside a `DisabledTooltip`
   * when the integration is unavailable.
   */
  wrapTrigger?: (trigger: React.ReactElement) => React.ReactNode
}

export interface SettingsPageScaffoldProps {
  tabs: SettingsTab[]
  /** Defaults to the first tab. */
  defaultTab?: string
  subheading?: React.ReactNode
  /** Defaults to "Settings" — every app uses that today. */
  heading?: string
  padding?: keyof typeof PADDING_CLASSES
  /**
   * Rendered after the tab strip, outside `PageTabs` — the sign-out card in
   * Core and ai-tutor. Kept a slot rather than owned, since apps sign out
   * differently.
   */
  footer?: React.ReactNode
  /** Rendered between the heading and the tab strip — e.g. Core's password-expired banner. */
  beforeTabs?: React.ReactNode
  /**
   * Wraps each tab body. Core opts in to its `ScrollReveal` motion here rather
   * than hand-wrapping every tab, which is how its tabs drifted apart.
   */
  renderTabBody?: (content: React.ReactNode, tab: SettingsTab) => React.ReactNode
}

/**
 * Shared scaffold for the three Settings pages.
 *
 * These pages were never actually unified — they converged on
 * `PageHeading` + controlled `PageTabs` by independent copy-paste, and settings
 * was the one page family the #1087/#1145 debloat pass skipped. As a result the
 * tab-content spacing drifted (uniform in ai-tutor, missing on two Core tabs and
 * both QM tabs, then patched with ad-hoc `mt-4` on individual cards). Owning the
 * `space-y-6` here is what stops that recurring.
 */
export function SettingsPageScaffold({
  tabs,
  defaultTab,
  subheading,
  heading = "Settings",
  padding = "none",
  footer,
  beforeTabs,
  renderTabBody,
}: SettingsPageScaffoldProps) {
  const [activeTab, setActiveTab] = React.useState(defaultTab ?? tabs[0]?.value ?? "")

  return (
    <div className={PADDING_CLASSES[padding]}>
      <PageHeading heading={heading} subheading={subheading} />

      {beforeTabs}

      <PageTabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <PageTabsList>
          {tabs.map((tab) => {
            const trigger = (
              <PageTabsTrigger value={tab.value}>
                {tab.icon}
                {tab.label}
              </PageTabsTrigger>
            )
            return (
              <React.Fragment key={tab.value}>
                {tab.wrapTrigger ? tab.wrapTrigger(trigger) : trigger}
              </React.Fragment>
            )
          })}
        </PageTabsList>

        {tabs.map((tab) => (
          <PageTabsContent key={tab.value} value={tab.value} className="space-y-6">
            {renderTabBody ? renderTabBody(tab.content, tab) : tab.content}
          </PageTabsContent>
        ))}
      </PageTabs>

      {footer}
    </div>
  )
}
