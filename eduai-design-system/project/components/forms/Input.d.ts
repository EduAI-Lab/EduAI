export interface InputProps {
  /** Field label — rendered as <label> above the input */
  label?: string;
  /** HTML id — links label to input via htmlFor */
  id?: string;
  /** Input type */
  type?: "text" | "email" | "password" | "search" | "url" | "tel" | "number";
  /** Placeholder text */
  placeholder?: string;
  /** Controlled value */
  value?: string;
  /** Uncontrolled default value */
  defaultValue?: string;
  /** Change handler */
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Error message — displayed in red below input; also sets error border */
  error?: string;
  /** Helper text — displayed below input when no error */
  helperText?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Required field — shows asterisk on label */
  required?: boolean;
  /** Leading affix (icon or text) inside the input border */
  prefix?: React.ReactNode;
  /** Trailing affix (icon or text) inside the input border */
  suffix?: React.ReactNode;
  /** Styles for the outer wrapper div */
  style?: React.CSSProperties;
  /** Styles for the inner <input> element */
  inputStyle?: React.CSSProperties;
}
