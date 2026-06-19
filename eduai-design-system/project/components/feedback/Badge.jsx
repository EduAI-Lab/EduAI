import * as React from "react";

/**
 * EduAI Badge — compact label for roles, statuses, and counts.
 */
export function Badge({
  children,
  variant = "default",
  role = null,
  size = "default",
  dot = false,
  style = {},
  ...props
}) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    fontFamily: "var(--font-sans)",
    fontWeight: 600,
    borderRadius: "var(--radius-full)",
    border: "1px solid transparent",
    whiteSpace: "nowrap",
    lineHeight: 1,
  };

  const sizes = {
    sm:      { fontSize: "10px", padding: "2px 6px" },
    default: { fontSize: "11px", padding: "3px 8px" },
    lg:      { fontSize: "13px", padding: "4px 10px" },
  };

  const roleColors = {
    ADMIN:      { background: "var(--color-role-admin)",      color: "#fff", borderColor: "transparent" },
    UNIT_ADMIN: { background: "var(--color-role-unit-admin)", color: "#fff", borderColor: "transparent" },
    INSTRUCTOR: { background: "var(--color-role-instructor)", color: "#fff", borderColor: "transparent" },
    TA:         { background: "var(--color-role-ta)",         color: "#fff", borderColor: "transparent" },
    STUDENT:    { background: "var(--color-role-student)",    color: "#fff", borderColor: "transparent" },
  };

  const variantColors = {
    default: {
      background: "var(--primary)",
      color: "var(--primary-foreground)",
      borderColor: "transparent",
    },
    secondary: {
      background: "var(--secondary)",
      color: "var(--secondary-foreground)",
      borderColor: "transparent",
    },
    outline: {
      background: "transparent",
      color: "var(--foreground)",
      borderColor: "var(--border)",
    },
    muted: {
      background: "var(--muted)",
      color: "var(--muted-foreground)",
      borderColor: "transparent",
    },
    success: {
      background: "var(--color-success-100)",
      color: "var(--color-success-700)",
      borderColor: "var(--color-success-500)",
    },
    warning: {
      background: "var(--color-warning-100)",
      color: "var(--color-warning-700)",
      borderColor: "var(--color-warning-500)",
    },
    destructive: {
      background: "var(--color-error-100)",
      color: "var(--color-error-700)",
      borderColor: "var(--color-error-500)",
    },
    gold: {
      background: "var(--color-gold-100)",
      color: "var(--color-gold-700)",
      borderColor: "var(--color-gold-400)",
    },
  };

  const colors = role
    ? roleColors[role] || roleColors.STUDENT
    : variantColors[variant] || variantColors.default;

  const computed = {
    ...base,
    ...sizes[size] || sizes.default,
    ...colors,
    ...style,
  };

  return (
    <span style={computed} {...props}>
      {dot && (
        <span style={{
          width: "6px", height: "6px", borderRadius: "50%",
          background: "currentColor", opacity: 0.7, flexShrink: 0,
        }} />
      )}
      {children}
    </span>
  );
}
