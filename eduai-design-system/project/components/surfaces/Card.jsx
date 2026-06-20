import * as React from "react";

/**
 * EduAI Card system — container pattern used throughout the app.
 * Provides Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter.
 */

export function Card({ children, hoverable = false, style = {}, ...props }) {
  const [hovered, setHovered] = React.useState(false);

  const cardStyle = {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    color: "var(--card-foreground)",
    display: "flex",
    flexDirection: "column",
    boxShadow: hovered && hoverable ? "var(--shadow-sm)" : "var(--shadow-2xs)",
    transition: "box-shadow 150ms ease, transform 150ms ease",
    transform: hovered && hoverable ? "translateY(-1px)" : "none",
    overflow: "hidden",
    ...style,
  };

  return (
    <div
      style={cardStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, style = {}, ...props }) {
  return (
    <div
      style={{
        padding: "20px 20px 0",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, style = {}, ...props }) {
  return (
    <h3
      style={{
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-lg)",
        fontWeight: 600,
        color: "var(--card-foreground)",
        margin: 0,
        letterSpacing: "var(--tracking-normal)",
        ...style,
      }}
      {...props}
    >
      {children}
    </h3>
  );
}

export function CardDescription({ children, style = {}, ...props }) {
  return (
    <p
      style={{
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        color: "var(--muted-foreground)",
        margin: 0,
        lineHeight: "var(--leading-normal)",
        ...style,
      }}
      {...props}
    >
      {children}
    </p>
  );
}

export function CardContent({ children, style = {}, ...props }) {
  return (
    <div
      style={{
        padding: "16px 20px",
        flex: 1,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardFooter({ children, style = {}, ...props }) {
  return (
    <div
      style={{
        padding: "0 20px 20px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        borderTop: "1px solid var(--border)",
        marginTop: "auto",
        paddingTop: "14px",
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export function StatCard({ label, value, trend, trendLabel, style = {} }) {
  const isPositive = trend && trend > 0;
  const isNegative = trend && trend < 0;

  return (
    <Card style={{
      background: "linear-gradient(to bottom, oklch(from var(--primary) l c h / 0.05), var(--card))",
      ...style,
    }}>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <CardTitle style={{ fontSize: "var(--text-2xl)", fontWeight: 600 }}>{value}</CardTitle>
          {trend !== undefined && (
            <span style={{
              fontSize: "12px",
              fontWeight: 600,
              color: isPositive ? "var(--color-success-700)" : isNegative ? "var(--destructive)" : "var(--muted-foreground)",
              display: "flex",
              alignItems: "center",
              gap: "2px",
              background: isPositive ? "var(--color-success-100)" : isNegative ? "var(--color-error-100)" : "var(--muted)",
              padding: "2px 7px",
              borderRadius: "var(--radius-full)",
            }}>
              {isPositive ? "↑" : isNegative ? "↓" : "—"} {Math.abs(trend)}%
            </span>
          )}
        </div>
      </CardHeader>
      {trendLabel && (
        <CardContent style={{ paddingTop: "8px" }}>
          <span style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>{trendLabel}</span>
        </CardContent>
      )}
    </Card>
  );
}
