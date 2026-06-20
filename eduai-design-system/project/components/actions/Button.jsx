import * as React from "react";

/**
 * EduAI Button — primary interactive action component.
 * Self-contained; references design tokens via CSS custom properties.
 */
export function Button({
  children,
  variant = "primary",
  size = "default",
  disabled = false,
  icon = null,
  iconPosition = "left",
  fullWidth = false,
  onClick,
  type = "button",
  style = {},
  ...props
}) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    fontFamily: "var(--font-sans)",
    fontWeight: 500,
    letterSpacing: "var(--tracking-normal)",
    borderRadius: "var(--radius-base)",
    border: "1px solid transparent",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: "background 150ms ease, opacity 150ms ease, box-shadow 150ms ease",
    textDecoration: "none",
    whiteSpace: "nowrap",
    outline: "none",
    width: fullWidth ? "100%" : undefined,
  };

  const sizes = {
    sm:      { fontSize: "13px", padding: "6px 12px",  minHeight: "32px" },
    default: { fontSize: "14px", padding: "8px 16px",  minHeight: "38px" },
    lg:      { fontSize: "15px", padding: "11px 20px", minHeight: "44px" },
    icon:    { fontSize: "14px", padding: "0",         minHeight: "38px", width: "38px" },
  };

  const variants = {
    primary: {
      background: "var(--primary)",
      color: "var(--primary-foreground)",
      borderColor: "var(--primary)",
    },
    secondary: {
      background: "var(--secondary)",
      color: "var(--secondary-foreground)",
      borderColor: "var(--secondary)",
    },
    outline: {
      background: "transparent",
      color: "var(--primary)",
      borderColor: "var(--border)",
    },
    ghost: {
      background: "transparent",
      color: "var(--foreground)",
      borderColor: "transparent",
    },
    destructive: {
      background: "var(--destructive)",
      color: "var(--destructive-foreground)",
      borderColor: "var(--destructive)",
    },
    gold: {
      background: "var(--color-gold-100)",
      color: "var(--color-gold-700)",
      borderColor: "var(--color-gold-400)",
    },
  };

  const [hovered, setHovered] = React.useState(false);

  const hoverModifier = hovered && !disabled ? { filter: "brightness(0.92)" } : {};

  const computed = {
    ...base,
    ...sizes[size] || sizes.default,
    ...variants[variant] || variants.primary,
    ...hoverModifier,
    ...style,
  };

  return (
    <button
      type={type}
      disabled={disabled}
      style={computed}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...props}
    >
      {icon && iconPosition === "left" && (
        <span style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>{icon}</span>
      )}
      {children}
      {icon && iconPosition === "right" && (
        <span style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>{icon}</span>
      )}
    </button>
  );
}
