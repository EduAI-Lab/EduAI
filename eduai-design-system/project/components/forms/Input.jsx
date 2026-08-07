import * as React from "react";

/**
 * EduAI Input — labeled text input with optional error and helper text.
 * Includes label, input, error message, and helper text as a unit.
 */
export function Input({
  label,
  id,
  type = "text",
  placeholder,
  value,
  defaultValue,
  onChange,
  error,
  helperText,
  disabled = false,
  required = false,
  prefix = null,
  suffix = null,
  style = {},
  inputStyle = {},
  ...props
}) {
  const [focused, setFocused] = React.useState(false);

  const wrapperStyle = {
    display: "flex",
    flexDirection: "column",
    gap: "5px",
    fontFamily: "var(--font-sans)",
    ...style,
  };

  const labelStyle = {
    fontSize: "13px",
    fontWeight: 500,
    color: disabled ? "var(--muted-foreground)" : "var(--foreground)",
    display: "flex",
    alignItems: "center",
    gap: "4px",
  };

  const inputWrapStyle = {
    display: "flex",
    alignItems: "center",
    borderRadius: "var(--radius-md)",
    border: `1px solid ${error ? "var(--destructive)" : focused ? "var(--ring)" : "var(--border)"}`,
    background: disabled ? "var(--muted)" : "var(--input)",
    boxShadow: focused
      ? error
        ? "var(--shadow-focus-error)"
        : "var(--shadow-focus)"
      : "none",
    transition: "border-color 150ms ease, box-shadow 150ms ease",
    overflow: "hidden",
  };

  const theInputStyle = {
    flex: 1,
    fontSize: "14px",
    padding: "8px 12px",
    background: "transparent",
    border: "none",
    outline: "none",
    color: disabled ? "var(--muted-foreground)" : "var(--foreground)",
    fontFamily: "var(--font-sans)",
    cursor: disabled ? "not-allowed" : "text",
    minHeight: "38px",
    ...inputStyle,
  };

  const affixStyle = {
    padding: "0 10px",
    color: "var(--muted-foreground)",
    fontSize: "13px",
    display: "flex",
    alignItems: "center",
    borderRight: prefix ? `1px solid var(--border)` : undefined,
    borderLeft: suffix ? `1px solid var(--border)` : undefined,
    background: "var(--muted)",
    alignSelf: "stretch",
  };

  return (
    <div style={wrapperStyle}>
      {label && (
        <label htmlFor={id} style={labelStyle}>
          {label}
          {required && <span style={{ color: "var(--destructive)" }}>*</span>}
        </label>
      )}
      <div style={inputWrapStyle}>
        {prefix && <div style={affixStyle}>{prefix}</div>}
        <input
          id={id}
          type={type}
          placeholder={placeholder}
          value={value}
          defaultValue={defaultValue}
          onChange={onChange}
          disabled={disabled}
          required={required}
          style={theInputStyle}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...props}
        />
        {suffix && <div style={{ ...affixStyle, borderLeft: `1px solid var(--border)`, borderRight: undefined }}>{suffix}</div>}
      </div>
      {error && (
        <span style={{ fontSize: "12px", color: "var(--destructive)", display: "flex", alignItems: "center", gap: "4px" }}>
          {error}
        </span>
      )}
      {helperText && !error && (
        <span style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>
          {helperText}
        </span>
      )}
    </div>
  );
}
