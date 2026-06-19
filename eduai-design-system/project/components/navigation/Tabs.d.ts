export interface TabsProps {
  /** Tab definitions */
  tabs: Array<{
    /** Unique tab identifier */
    id: string;
    /** Displayed tab label */
    label: string;
    /** Content rendered when this tab is active */
    content?: React.ReactNode;
    /** Leading icon element */
    icon?: React.ReactNode;
    /** Count badge shown beside the label */
    badge?: string | number;
    /** Prevents interaction — tab renders greyed out */
    disabled?: boolean;
  }>;
  /** Initially active tab id — defaults to first tab */
  defaultTab?: string;
  /** Called with the new tab id whenever the active tab changes */
  onTabChange?: (tabId: string) => void;
  /** Styles applied to the tab strip container */
  style?: React.CSSProperties;
  /** Styles applied to the tab panel (content area) */
  contentStyle?: React.CSSProperties;
}
