export interface AvatarProps {
  /** Image source URL */
  src?: string;
  /** Alt text for image */
  alt?: string;
  /** User's display name — used for initials fallback and hue generation */
  name?: string;
  /** Size preset */
  size?: "xs" | "sm" | "default" | "lg" | "xl";
  /** Shape variant */
  shape?: "circle" | "rounded" | "square";
  style?: React.CSSProperties;
}

export interface TabsProps {
  /** Tab definitions */
  tabs: Array<{
    id: string;
    label: string;
    content?: React.ReactNode;
    icon?: React.ReactNode;
    badge?: string | number;
    disabled?: boolean;
  }>;
  /** Initially active tab id */
  defaultTab?: string;
  /** Called when tab changes */
  onTabChange?: (tabId: string) => void;
  style?: React.CSSProperties;
  contentStyle?: React.CSSProperties;
}
