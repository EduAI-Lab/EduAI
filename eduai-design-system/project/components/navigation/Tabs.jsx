import * as React from "react";

/**
 * EduAI Tabs — horizontal tab strip for content switching.
 * Used in course detail (Overview/Materials/Topics/Enrollments/Staff/Embedding)
 * and settings (API Keys/Canvas).
 */
export function Tabs({
  tabs = [],
  defaultTab,
  onTabChange,
  style = {},
  contentStyle = {},
}) {
  const [active, setActive] = React.useState(defaultTab || (tabs[0] && tabs[0].id));

  const handleChange = (id) => {
    setActive(id);
    if (onTabChange) onTabChange(id);
  };

  const stripStyle = {
    display: "flex",
    gap: "2px",
    borderBottom: "1px solid var(--border)",
    marginBottom: "20px",
    fontFamily: "var(--font-sans)",
    ...style,
  };

  const activeTab = tabs.find(t => t.id === active);

  return (
    <div>
      <div style={stripStyle} role="tablist">
        {tabs.map(tab => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                fontSize: "14px",
                fontWeight: isActive ? 600 : 400,
                color: isActive ? "var(--primary)" : "var(--muted-foreground)",
                background: "transparent",
                border: "none",
                borderBottom: isActive ? "2px solid var(--primary)" : "2px solid transparent",
                marginBottom: "-1px",
                cursor: tab.disabled ? "not-allowed" : "pointer",
                opacity: tab.disabled ? 0.5 : 1,
                transition: "color 150ms ease, border-color 150ms ease",
                outline: "none",
                borderRadius: "var(--radius-sm) var(--radius-sm) 0 0",
                whiteSpace: "nowrap",
              }}
              onClick={() => !tab.disabled && handleChange(tab.id)}
              disabled={tab.disabled}
            >
              {tab.icon && <span style={{ display: "flex", alignItems: "center" }}>{tab.icon}</span>}
              {tab.label}
              {tab.badge !== undefined && (
                <span style={{
                  fontSize: "10px", fontWeight: 600,
                  background: isActive ? "var(--primary)" : "var(--muted)",
                  color: isActive ? "var(--primary-foreground)" : "var(--muted-foreground)",
                  padding: "1px 5px", borderRadius: "var(--radius-full)", lineHeight: 1.4,
                }}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div style={contentStyle} role="tabpanel">
        {activeTab && activeTab.content}
      </div>
    </div>
  );
}
