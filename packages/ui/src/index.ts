// ── Utilities ─────────────────────────────────────────────────────────────
export { cn, getInitials } from "./utils"

// ── Theme ──────────────────────────────────────────────────────────────────
export { ThemeProvider, useTheme } from "./theme-provider"
export { initThemeSync, broadcastThemeChange, closeThemeSync } from "./lib/theme-sync"
export type { Theme as ThemeType } from "./lib/theme-sync"

// ── Bug report ─────────────────────────────────────────────────────────────
export { BugReportDialog } from './bug-report-dialog'
export type { BugReportType, BugReportSubmitData } from './bug-report-dialog'

// ── Domain components ──────────────────────────────────────────────────────
export { RoleBadge } from "./role-badge"
export type { RoleBadgeProps } from "./role-badge"
export { CourseColorBar, COURSE_COLORS } from "./course-color-bar"
export type { CourseColorBarProps } from "./course-color-bar"
export {
  COURSE_COLOR_PRESETS,
  DEFAULT_COURSE_PALETTE,
  courseThemeVars,
  courseHeroBackgroundStyle,
  resolvePaletteAccent,
  defaultColorIndexForCourse,
  paletteColorAtIndex,
} from "./course-theme"
export type { CourseAccentColor } from "./course-theme"
export { StatCard } from "./stat-card"
export type { StatCardProps } from "./stat-card"
export { Avatar } from "./avatar"
export type { AvatarProps } from "./avatar"
export { PageHeading } from "./page-heading"
export type { PageHeadingProps } from "./page-heading"
export { CourseHeroCard } from "./course-hero-card"
export type { CourseHeroCardProps } from "./course-hero-card"
export { CourseCard } from "./course-card"
export type { CourseCardProps, CourseCardAction } from "./course-card"
export { QuestionCard } from "./question-card"
export type {
  QuestionCardProps,
  QuestionCardChoice,
  QuestionCardStatus,
  QuestionDifficulty,
} from "./question-card"
export { StatusBadge } from "./status-badge"
export type { StatusBadgeProps } from "./status-badge"
export { QuestionStatusBadge, questionStatus } from "./question-status-badge"
export type { QuestionStatusBadgeProps, QuestionStatus, QuestionStatusVariant } from "./question-status-badge"
export { VariantBadge, variantLabel } from "./variant-badge"
export type { VariantBadgeProps, VariantIdentity } from "./variant-badge"
export { PageTabs, PageTabsList, PageTabsTrigger, PageTabsContent } from "./page-tabs"
export type { PageTabsProps, PageTabsListProps, PageTabsTriggerProps, PageTabsContentProps } from "./page-tabs"
export { ConfirmDialog } from "./confirm-dialog"
export type { ConfirmDialogProps } from "./confirm-dialog"
export { SegmentedControl } from "./segmented-control"
export type { SegmentedControlProps, SegmentedControlOption } from "./segmented-control"
export { ThemeToggle } from "./theme-toggle"
export type { ThemeToggleProps } from "./theme-toggle"
export { NavUser } from "./nav-user"
export type { NavUserProps, NavUserItem } from "./nav-user"
export { NavMain } from "./nav-main"
export type { NavMainProps, NavMainItem, NavGroupItem } from "./nav-main"
export { NavSecondary } from "./nav-secondary"
export type { NavSecondaryProps, NavSecondaryItem } from "./nav-secondary"
export { AppSidebar } from "./app-sidebar"
export type { AppSidebarProps } from "./app-sidebar"
export { BrandSwitcher, QUESTION_MAKER_ROLES } from "./app-launcher"
export type { BrandSwitcherProps, LauncherApp } from "./app-launcher"
export { SiteHeader } from "./site-header"
export type { SiteHeaderProps } from "./site-header"
export { CommandPalette, CommandSearchButton, buildAppSwitcherGroup } from "./command-palette"
export type {
  CommandPaletteProps,
  CommandPaletteGroup,
  CommandPaletteItem,
  CommandSearchButtonProps,
} from "./command-palette"
export { CourseSwitcher } from "./course-switcher"
export type { CourseSwitcherProps, CourseSwitcherOption, CourseSwitcherId } from "./course-switcher"
export { AIServiceIndicators } from "./ai-service-indicators"
export type { AIServiceIndicatorsProps, ServiceStatus, ServiceState } from "./ai-service-indicators"
export { AccessibilitySettings } from "./settings/accessibility-settings"
export type { AccessibilitySettingsProps, UiDensity as AccessibilityUiDensity, UiTheme as AccessibilityUiTheme } from "./settings/accessibility-settings"
export { ProvidersTable } from "./settings/providers-table"
export type { ProvidersTableProps, AIProviderRow } from "./settings/providers-table"
export { ProviderFormDialog } from "./settings/provider-form-dialog"
export type { ProviderFormDialogProps, ProviderFormData, AIProviderRecord } from "./settings/provider-form-dialog"

// ── Analytics charts ───────────────────────────────────────────────────────
export { DonutChart } from "./charts/donut-chart"
export type { DonutChartProps, DonutSegment } from "./charts/donut-chart"
export { MeterBar } from "./charts/meter-bar"
export type { MeterBarProps } from "./charts/meter-bar"
export { StackedBar } from "./charts/stacked-bar"
export type { StackedBarProps, StackedSegment } from "./charts/stacked-bar"
export { PanelCard } from "./charts/panel-card"
export type { PanelCardProps } from "./charts/panel-card"
export { QuestionAnalytics } from "./charts/question-analytics"
export type { QuestionAnalyticsProps } from "./charts/question-analytics"

// ── DS-aligned shadcn primitives ───────────────────────────────────────────
export { Button, buttonVariants } from "./ui/button"
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardAction } from "./ui/card"
export { Badge, badgeVariants } from "./ui/badge"
export { Input } from "./ui/input"

// ── shadcn primitives ──────────────────────────────────────────────────────
export * from "./ui/accordion"
export * from "./ui/alert"
export * from "./ui/alert-dialog"
export * from "./ui/aspect-ratio"
// Avatar: export AvatarImage/AvatarFallback only — Avatar root conflicts with DS Avatar above
export { AvatarImage, AvatarFallback } from "./ui/avatar"
export * from "./ui/breadcrumb"
export * from "./ui/calendar"
export * from "./ui/carousel"
export * from "./ui/chart"
export * from "./ui/chat-container"
export * from "./ui/checkbox"
export * from "./ui/code-block"
export * from "./ui/collapsible"
export * from "./ui/command"
export * from "./ui/context-menu"
export * from "./ui/dialog"
export * from "./ui/drawer"
export * from "./ui/dropdown-menu"
export * from "./ui/form"
export * from "./ui/hover-card"
export * from "./ui/input-otp"
export * from "./ui/label"
export * from "./ui/loader"
export * from "./ui/markdown"
export { LazyStreamdown } from "./ui/lazy-streamdown"
export * from "./ui/menubar"
export * from "./ui/navigation-menu"
export * from "./ui/pagination"
export * from "./ui/popover"
export * from "./ui/progress"
export * from "./ui/prompt-input"
export * from "./ui/prompt-suggestion"
export * from "./ui/radio-group"
export * from "./ui/resizable"
export * from "./ui/response-stream"
export * from "./ui/scroll-area"
export * from "./ui/scroll-button"
export * from "./ui/select"
export * from "./ui/separator"
export * from "./ui/sheet"
export * from "./ui/skeleton"
export * from "./ui/slider"
export * from "./ui/sonner"
export * from "./ui/switch"
export * from "./ui/table"
export * from "./ui/tabs"
export * from "./ui/textarea"
export * from "./ui/toggle"
export * from "./ui/toggle-group"
export * from "./ui/tool"
export * from "./ui/tooltip"
export * from "./ui/sidebar"
export * from "./ui/message"
export { useIsMobile } from "./hooks/use-mobile"
export { Combobox, MultiSelect } from "./ui/combobox"
export type { ComboboxOption, ComboboxProps, MultiSelectProps } from "./ui/combobox"
