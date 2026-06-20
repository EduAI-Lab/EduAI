export interface BadgeProps {
  /** Badge label */
  children: React.ReactNode;
  /** Visual variant — overridden when `role` is set */
  variant?: "default" | "secondary" | "outline" | "muted" | "success" | "warning" | "destructive" | "gold";
  /** User role — maps to semantic role color tokens */
  role?: "ADMIN" | "UNIT_ADMIN" | "INSTRUCTOR" | "TA" | "STUDENT";
  /** Size preset */
  size?: "sm" | "default" | "lg";
  /** Show a small dot indicator before the label */
  dot?: boolean;
  /** Additional inline styles */
  style?: React.CSSProperties;
}
