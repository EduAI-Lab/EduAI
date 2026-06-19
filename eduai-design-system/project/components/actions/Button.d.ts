/**
 * @startingPoint section="Components" subtitle="Primary action button — all variants and sizes" viewport="700x280"
 */
export interface ButtonProps {
  /** Button label / content */
  children: React.ReactNode;
  /** Visual style variant */
  variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive" | "gold";
  /** Size preset */
  size?: "sm" | "default" | "lg" | "icon";
  /** Disabled state — reduces opacity and blocks interaction */
  disabled?: boolean;
  /** Leading or trailing icon element (inline SVG or component) */
  icon?: React.ReactNode;
  /** Which side to place the icon */
  iconPosition?: "left" | "right";
  /** Expand to full container width */
  fullWidth?: boolean;
  /** Button type attribute */
  type?: "button" | "submit" | "reset";
  /** Click handler */
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Additional inline styles */
  style?: React.CSSProperties;
}
