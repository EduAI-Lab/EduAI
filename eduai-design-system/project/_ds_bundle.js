/* @ds-bundle: {"format":3,"namespace":"EduAIDesignSystem_4b4b4d","components":[{"name":"Button","sourcePath":"components/actions/Button.jsx"},{"name":"Badge","sourcePath":"components/feedback/Badge.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Avatar","sourcePath":"components/navigation/Avatar.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"},{"name":"Card","sourcePath":"components/surfaces/Card.jsx"},{"name":"CardHeader","sourcePath":"components/surfaces/Card.jsx"},{"name":"CardTitle","sourcePath":"components/surfaces/Card.jsx"},{"name":"CardDescription","sourcePath":"components/surfaces/Card.jsx"},{"name":"CardContent","sourcePath":"components/surfaces/Card.jsx"},{"name":"CardFooter","sourcePath":"components/surfaces/Card.jsx"},{"name":"StatCard","sourcePath":"components/surfaces/Card.jsx"}],"sourceHashes":{"components/actions/Button.jsx":"dd02034f42c7","components/feedback/Badge.jsx":"42ad8dc58287","components/forms/Input.jsx":"efacce4ae474","components/navigation/Avatar.jsx":"4197100be9e5","components/navigation/Tabs.jsx":"18080cc5fa8a","components/surfaces/Card.jsx":"4ed284b94f14","ui_kits/core/AdminUsers.jsx":"e3cff2867665","ui_kits/core/Auth.jsx":"c253b9f6a3a0","ui_kits/core/Chat.jsx":"ed8e7e1f90eb","ui_kits/core/CourseDetail.jsx":"a59fc5b13d03","ui_kits/core/Courses.jsx":"a994dfaad8b1","ui_kits/core/Dashboard.jsx":"79bc067155c0","ui_kits/core/Onboarding.jsx":"7a51b8f30647","ui_kits/core/Settings.jsx":"d15e152a1799","ui_kits/core/Sidebar.jsx":"693c1d2b4664"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.EduAIDesignSystem_4b4b4d = window.EduAIDesignSystem_4b4b4d || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/actions/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * EduAI Button — primary interactive action component.
 * Self-contained; references design tokens via CSS custom properties.
 */
function Button({
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
    width: fullWidth ? "100%" : undefined
  };
  const sizes = {
    sm: {
      fontSize: "13px",
      padding: "6px 12px",
      minHeight: "32px"
    },
    default: {
      fontSize: "14px",
      padding: "8px 16px",
      minHeight: "38px"
    },
    lg: {
      fontSize: "15px",
      padding: "11px 20px",
      minHeight: "44px"
    },
    icon: {
      fontSize: "14px",
      padding: "0",
      minHeight: "38px",
      width: "38px"
    }
  };
  const variants = {
    primary: {
      background: "var(--primary)",
      color: "var(--primary-foreground)",
      borderColor: "var(--primary)"
    },
    secondary: {
      background: "var(--secondary)",
      color: "var(--secondary-foreground)",
      borderColor: "var(--secondary)"
    },
    outline: {
      background: "transparent",
      color: "var(--primary)",
      borderColor: "var(--border)"
    },
    ghost: {
      background: "transparent",
      color: "var(--foreground)",
      borderColor: "transparent"
    },
    destructive: {
      background: "var(--destructive)",
      color: "var(--destructive-foreground)",
      borderColor: "var(--destructive)"
    },
    gold: {
      background: "var(--color-gold-100)",
      color: "var(--color-gold-700)",
      borderColor: "var(--color-gold-400)"
    }
  };
  const [hovered, setHovered] = React.useState(false);
  const hoverModifier = hovered && !disabled ? {
    filter: "brightness(0.92)"
  } : {};
  const computed = {
    ...base,
    ...(sizes[size] || sizes.default),
    ...(variants[variant] || variants.primary),
    ...hoverModifier,
    ...style
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    style: computed,
    onClick: onClick,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false)
  }, props), icon && iconPosition === "left" && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      flexShrink: 0
    }
  }, icon), children, icon && iconPosition === "right" && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      flexShrink: 0
    }
  }, icon));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/Button.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * EduAI Badge — compact label for roles, statuses, and counts.
 */
function Badge({
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
    lineHeight: 1
  };
  const sizes = {
    sm: {
      fontSize: "10px",
      padding: "2px 6px"
    },
    default: {
      fontSize: "11px",
      padding: "3px 8px"
    },
    lg: {
      fontSize: "13px",
      padding: "4px 10px"
    }
  };
  const roleColors = {
    ADMIN: {
      background: "var(--color-role-admin)",
      color: "#fff",
      borderColor: "transparent"
    },
    UNIT_ADMIN: {
      background: "var(--color-role-unit-admin)",
      color: "#fff",
      borderColor: "transparent"
    },
    INSTRUCTOR: {
      background: "var(--color-role-instructor)",
      color: "#fff",
      borderColor: "transparent"
    },
    TA: {
      background: "var(--color-role-ta)",
      color: "#fff",
      borderColor: "transparent"
    },
    STUDENT: {
      background: "var(--color-role-student)",
      color: "#fff",
      borderColor: "transparent"
    }
  };
  const variantColors = {
    default: {
      background: "var(--primary)",
      color: "var(--primary-foreground)",
      borderColor: "transparent"
    },
    secondary: {
      background: "var(--secondary)",
      color: "var(--secondary-foreground)",
      borderColor: "transparent"
    },
    outline: {
      background: "transparent",
      color: "var(--foreground)",
      borderColor: "var(--border)"
    },
    muted: {
      background: "var(--muted)",
      color: "var(--muted-foreground)",
      borderColor: "transparent"
    },
    success: {
      background: "var(--color-success-100)",
      color: "var(--color-success-700)",
      borderColor: "var(--color-success-500)"
    },
    warning: {
      background: "var(--color-warning-100)",
      color: "var(--color-warning-700)",
      borderColor: "var(--color-warning-500)"
    },
    destructive: {
      background: "var(--color-error-100)",
      color: "var(--color-error-700)",
      borderColor: "var(--color-error-500)"
    },
    gold: {
      background: "var(--color-gold-100)",
      color: "var(--color-gold-700)",
      borderColor: "var(--color-gold-400)"
    }
  };
  const colors = role ? roleColors[role] || roleColors.STUDENT : variantColors[variant] || variantColors.default;
  const computed = {
    ...base,
    ...(sizes[size] || sizes.default),
    ...colors,
    ...style
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: computed
  }, props), dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: "6px",
      height: "6px",
      borderRadius: "50%",
      background: "currentColor",
      opacity: 0.7,
      flexShrink: 0
    }
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Badge.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * EduAI Input — labeled text input with optional error and helper text.
 * Includes label, input, error message, and helper text as a unit.
 */
function Input({
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
    ...style
  };
  const labelStyle = {
    fontSize: "13px",
    fontWeight: 500,
    color: disabled ? "var(--muted-foreground)" : "var(--foreground)",
    display: "flex",
    alignItems: "center",
    gap: "4px"
  };
  const inputWrapStyle = {
    display: "flex",
    alignItems: "center",
    borderRadius: "var(--radius-md)",
    border: `1px solid ${error ? "var(--destructive)" : focused ? "var(--ring)" : "var(--border)"}`,
    background: disabled ? "var(--muted)" : "var(--input)",
    boxShadow: focused ? error ? "var(--shadow-focus-error)" : "var(--shadow-focus)" : "none",
    transition: "border-color 150ms ease, box-shadow 150ms ease",
    overflow: "hidden"
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
    ...inputStyle
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
    alignSelf: "stretch"
  };
  return /*#__PURE__*/React.createElement("div", {
    style: wrapperStyle
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: id,
    style: labelStyle
  }, label, required && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--destructive)"
    }
  }, "*")), /*#__PURE__*/React.createElement("div", {
    style: inputWrapStyle
  }, prefix && /*#__PURE__*/React.createElement("div", {
    style: affixStyle
  }, prefix), /*#__PURE__*/React.createElement("input", _extends({
    id: id,
    type: type,
    placeholder: placeholder,
    value: value,
    defaultValue: defaultValue,
    onChange: onChange,
    disabled: disabled,
    required: required,
    style: theInputStyle,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false)
  }, props)), suffix && /*#__PURE__*/React.createElement("div", {
    style: {
      ...affixStyle,
      borderLeft: `1px solid var(--border)`,
      borderRight: undefined
    }
  }, suffix)), error && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "12px",
      color: "var(--destructive)",
      display: "flex",
      alignItems: "center",
      gap: "4px"
    }
  }, error), helperText && !error && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "12px",
      color: "var(--muted-foreground)"
    }
  }, helperText));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * EduAI Avatar — user avatar with image and initials fallback.
 */
function Avatar({
  src,
  alt,
  name,
  size = "default",
  shape = "rounded",
  style = {},
  ...props
}) {
  const [imgError, setImgError] = React.useState(false);
  const sizes = {
    xs: {
      width: "24px",
      height: "24px",
      fontSize: "9px"
    },
    sm: {
      width: "32px",
      height: "32px",
      fontSize: "12px"
    },
    default: {
      width: "40px",
      height: "40px",
      fontSize: "14px"
    },
    lg: {
      width: "48px",
      height: "48px",
      fontSize: "17px"
    },
    xl: {
      width: "64px",
      height: "64px",
      fontSize: "22px"
    }
  };
  const radius = shape === "circle" ? "50%" : shape === "rounded" ? "var(--radius-base)" : "var(--radius-sm)";
  const getInitials = n => {
    if (!n) return "?";
    return n.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2);
  };
  const getHue = n => {
    if (!n) return 259;
    let h = 0;
    for (let i = 0; i < n.length; i++) h = n.charCodeAt(i) + ((h << 5) - h);
    return Math.abs(h) % 360;
  };
  const hue = getHue(name);
  const avatarBg = `oklch(0.42 0.14 ${hue})`;
  const containerStyle = {
    ...(sizes[size] || sizes.default),
    borderRadius: radius,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    background: avatarBg,
    fontFamily: "var(--font-sans)",
    fontWeight: 600,
    color: "#fff",
    ...style
  };
  const showFallback = !src || imgError;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: containerStyle
  }, props), !showFallback ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: alt || name,
    style: {
      width: "100%",
      height: "100%",
      objectFit: "cover"
    },
    onError: () => setImgError(true)
  }) : /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: sizes[size]?.fontSize || "14px",
      lineHeight: 1
    }
  }, getInitials(name)));
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
/**
 * EduAI Tabs — horizontal tab strip for content switching.
 * Used in course detail (Overview/Materials/Topics/Enrollments/Staff/Embedding)
 * and settings (API Keys/Canvas).
 */
function Tabs({
  tabs = [],
  defaultTab,
  onTabChange,
  style = {},
  contentStyle = {}
}) {
  const [active, setActive] = React.useState(defaultTab || tabs[0] && tabs[0].id);
  const handleChange = id => {
    setActive(id);
    if (onTabChange) onTabChange(id);
  };
  const stripStyle = {
    display: "flex",
    gap: "2px",
    borderBottom: "1px solid var(--border)",
    marginBottom: "20px",
    fontFamily: "var(--font-sans)",
    ...style
  };
  const activeTab = tabs.find(t => t.id === active);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: stripStyle,
    role: "tablist"
  }, tabs.map(tab => {
    const isActive = tab.id === active;
    return /*#__PURE__*/React.createElement("button", {
      key: tab.id,
      role: "tab",
      "aria-selected": isActive,
      style: {
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
        whiteSpace: "nowrap"
      },
      onClick: () => !tab.disabled && handleChange(tab.id),
      disabled: tab.disabled
    }, tab.icon && /*#__PURE__*/React.createElement("span", {
      style: {
        display: "flex",
        alignItems: "center"
      }
    }, tab.icon), tab.label, tab.badge !== undefined && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: "10px",
        fontWeight: 600,
        background: isActive ? "var(--primary)" : "var(--muted)",
        color: isActive ? "var(--primary-foreground)" : "var(--muted-foreground)",
        padding: "1px 5px",
        borderRadius: "var(--radius-full)",
        lineHeight: 1.4
      }
    }, tab.badge));
  })), /*#__PURE__*/React.createElement("div", {
    style: contentStyle,
    role: "tabpanel"
  }, activeTab && activeTab.content));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * EduAI Card system — container pattern used throughout the app.
 * Provides Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter.
 */

function Card({
  children,
  hoverable = false,
  style = {},
  ...props
}) {
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
    ...style
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: cardStyle,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false)
  }, props), children);
}
function CardHeader({
  children,
  style = {},
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      padding: "20px 20px 0",
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      ...style
    }
  }, props), children);
}
function CardTitle({
  children,
  style = {},
  ...props
}) {
  return /*#__PURE__*/React.createElement("h3", _extends({
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: "var(--text-lg)",
      fontWeight: 600,
      color: "var(--card-foreground)",
      margin: 0,
      letterSpacing: "var(--tracking-normal)",
      ...style
    }
  }, props), children);
}
function CardDescription({
  children,
  style = {},
  ...props
}) {
  return /*#__PURE__*/React.createElement("p", _extends({
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: "var(--text-sm)",
      color: "var(--muted-foreground)",
      margin: 0,
      lineHeight: "var(--leading-normal)",
      ...style
    }
  }, props), children);
}
function CardContent({
  children,
  style = {},
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      padding: "16px 20px",
      flex: 1,
      ...style
    }
  }, props), children);
}
function CardFooter({
  children,
  style = {},
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      padding: "0 20px 20px",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      borderTop: "1px solid var(--border)",
      marginTop: "auto",
      paddingTop: "14px",
      ...style
    }
  }, props), children);
}
function StatCard({
  label,
  value,
  trend,
  trendLabel,
  style = {}
}) {
  const isPositive = trend && trend > 0;
  const isNegative = trend && trend < 0;
  return /*#__PURE__*/React.createElement(Card, {
    style: {
      background: "linear-gradient(to bottom, oklch(from var(--primary) l c h / 0.05), var(--card))",
      ...style
    }
  }, /*#__PURE__*/React.createElement(CardHeader, null, /*#__PURE__*/React.createElement(CardDescription, null, label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement(CardTitle, {
    style: {
      fontSize: "var(--text-2xl)",
      fontWeight: 600
    }
  }, value), trend !== undefined && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "12px",
      fontWeight: 600,
      color: isPositive ? "var(--color-success-700)" : isNegative ? "var(--destructive)" : "var(--muted-foreground)",
      display: "flex",
      alignItems: "center",
      gap: "2px",
      background: isPositive ? "var(--color-success-100)" : isNegative ? "var(--color-error-100)" : "var(--muted)",
      padding: "2px 7px",
      borderRadius: "var(--radius-full)"
    }
  }, isPositive ? "↑" : isNegative ? "↓" : "—", " ", Math.abs(trend), "%"))), trendLabel && /*#__PURE__*/React.createElement(CardContent, {
    style: {
      paddingTop: "8px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "12px",
      color: "var(--muted-foreground)"
    }
  }, trendLabel)));
}
Object.assign(__ds_scope, { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, StatCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/Card.jsx", error: String((e && e.message) || e) }); }

// ui_kits/core/AdminUsers.jsx
try { (() => {
/* AdminUsers.jsx — user management data table (ADMIN role) */

const USERS = [{
  name: "Dr. Sandra Hobbes",
  email: "s.hobbes@ubc.ca",
  role: "ADMIN",
  dept: "Computer Science",
  active: true,
  joined: "Jan 2024"
}, {
  name: "Prof. Gregor K.",
  email: "kiczales@cs.ubc.ca",
  role: "PROFESSOR",
  dept: "Computer Science",
  active: true,
  joined: "Jan 2024"
}, {
  name: "Prof. Sarah Chen",
  email: "s.chen@math.ubc.ca",
  role: "PROFESSOR",
  dept: "Mathematics",
  active: true,
  joined: "Feb 2024"
}, {
  name: "Tom Walker",
  email: "t.walker@ta.ubc.ca",
  role: "TA",
  dept: "Computer Science",
  active: true,
  joined: "Sep 2024"
}, {
  name: "Alex Chen",
  email: "alex.chen@student.ubc.ca",
  role: "STUDENT",
  dept: "Computer Science",
  active: true,
  joined: "Sep 2024"
}, {
  name: "Maria Santos",
  email: "m.santos@student.ubc.ca",
  role: "STUDENT",
  dept: "Mathematics",
  active: true,
  joined: "Sep 2024"
}, {
  name: "James Liu",
  email: "jliu@student.ubc.ca",
  role: "STUDENT",
  dept: "Physics",
  active: false,
  joined: "Sep 2024"
}, {
  name: "Priya Sharma",
  email: "p.sharma@student.ubc.ca",
  role: "STUDENT",
  dept: "Computer Science",
  active: true,
  joined: "Oct 2024"
}];
const ROLE_STYLE = {
  ADMIN: {
    label: "Admin",
    bg: "var(--color-role-admin)"
  },
  UNIT_ADMIN: {
    label: "Unit Admin",
    bg: "var(--color-role-unit-admin)"
  },
  PROFESSOR: {
    label: "Professor",
    bg: "var(--color-role-instructor)"
  },
  TA: {
    label: "TA",
    bg: "var(--color-role-ta)"
  },
  STUDENT: {
    label: "Student",
    bg: "var(--color-role-student)"
  }
};
function RoleBadge({
  role
}) {
  const r = ROLE_STYLE[role] || ROLE_STYLE.STUDENT;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "11px",
      fontWeight: 700,
      padding: "2px 8px",
      borderRadius: "999px",
      background: r.bg,
      color: "#fff"
    }
  }, r.label);
}
function AdminUsers() {
  const [search, setSearch] = React.useState("");
  const [filterRole, setFilterRole] = React.useState("All");
  const [showDialog, setShowDialog] = React.useState(false);
  const filtered = USERS.filter(u => {
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase());
    const matchRole = filterRole === "All" || u.role === filterRole;
    return matchSearch && matchRole;
  });
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      fontFamily: "var(--font-sans)",
      background: "var(--background)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: "56px",
      borderBottom: "1px solid var(--border)",
      flexShrink: 0,
      display: "flex",
      alignItems: "center",
      padding: "0 24px",
      justifyContent: "space-between",
      background: "var(--background)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      fontSize: "13px",
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement("span", null, "Home"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--border)"
    }
  }, "/"), /*#__PURE__*/React.createElement("span", null, "Admin"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--border)"
    }
  }, "/"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--foreground)",
      fontWeight: 500
    }
  }, "Users")), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowDialog(true),
    style: {
      display: "flex",
      alignItems: "center",
      gap: "7px",
      padding: "7px 14px",
      fontSize: "13px",
      fontWeight: 500,
      background: "var(--primary)",
      color: "var(--primary-foreground)",
      border: "none",
      borderRadius: "var(--radius-base)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 5v14M5 12h14"
  })), "Add User")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: "auto",
      padding: "24px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: "20px"
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: "22px",
      fontWeight: 700,
      color: "var(--foreground)",
      margin: "0 0 5px"
    }
  }, "User Management"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "14px",
      color: "var(--muted-foreground)",
      margin: 0
    }
  }, USERS.length, " total users \xB7 ", USERS.filter(u => u.active).length, " active")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "10px",
      marginBottom: "16px"
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: search,
    onChange: e => setSearch(e.target.value),
    placeholder: "Search by name or email\u2026",
    style: {
      padding: "7px 12px",
      fontSize: "13px",
      fontFamily: "var(--font-sans)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-base)",
      background: "var(--input)",
      color: "var(--foreground)",
      outline: "none",
      width: "260px"
    }
  }), /*#__PURE__*/React.createElement("select", {
    value: filterRole,
    onChange: e => setFilterRole(e.target.value),
    style: {
      padding: "7px 12px",
      fontSize: "13px",
      fontFamily: "var(--font-sans)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-base)",
      background: "var(--input)",
      color: "var(--foreground)",
      cursor: "pointer"
    }
  }, ["All", "ADMIN", "PROFESSOR", "TA", "STUDENT"].map(r => /*#__PURE__*/React.createElement("option", {
    key: r,
    value: r
  }, r === "All" ? "All roles" : ROLE_STYLE[r]?.label || r)))), /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "13px"
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      background: "var(--muted)"
    }
  }, ["User", "Role", "Department", "Status", "Joined", ""].map((h, i) => /*#__PURE__*/React.createElement("th", {
    key: i,
    style: {
      padding: "10px 14px",
      textAlign: "left",
      fontWeight: 600,
      color: "var(--muted-foreground)",
      fontSize: "11px",
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      borderBottom: "1px solid var(--border)"
    }
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, filtered.map((u, i) => /*#__PURE__*/React.createElement("tr", {
    key: i,
    style: {
      background: i % 2 === 0 ? "var(--card)" : "var(--background)"
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: "12px 14px",
      borderBottom: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "10px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "32px",
      height: "32px",
      borderRadius: "7px",
      flexShrink: 0,
      background: `oklch(0.42 0.14 ${[...u.name].reduce((h, c) => c.charCodeAt(0) + ((h << 5) - h), 0) % 360})`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#fff",
      fontWeight: 700,
      fontSize: "11px"
    }
  }, u.name.split(" ").map(p => p[0]).join("").slice(0, 2)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 500,
      color: "var(--foreground)"
    }
  }, u.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "12px",
      color: "var(--muted-foreground)"
    }
  }, u.email)))), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: "12px 14px",
      borderBottom: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement(RoleBadge, {
    role: u.role
  })), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: "12px 14px",
      color: "var(--muted-foreground)",
      borderBottom: "1px solid var(--border)"
    }
  }, u.dept), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: "12px 14px",
      borderBottom: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "5px",
      fontSize: "11px",
      fontWeight: 600,
      padding: "2px 8px",
      borderRadius: "999px",
      background: u.active ? "var(--color-success-100)" : "var(--muted)",
      color: u.active ? "var(--color-success-700)" : "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: "5px",
      height: "5px",
      borderRadius: "50%",
      background: u.active ? "var(--color-success-500)" : "var(--muted-foreground)"
    }
  }), u.active ? "Active" : "Inactive")), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: "12px 14px",
      color: "var(--muted-foreground)",
      borderBottom: "1px solid var(--border)"
    }
  }, u.joined), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: "12px 14px",
      borderBottom: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "6px"
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: {
      padding: "4px 10px",
      fontSize: "12px",
      background: "transparent",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-sm)",
      color: "var(--foreground)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, "Edit"), /*#__PURE__*/React.createElement("button", {
    style: {
      padding: "4px 10px",
      fontSize: "12px",
      background: "transparent",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-sm)",
      color: "var(--destructive)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, "Remove"))))))))), showDialog && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.4)",
      zIndex: 50,
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    },
    onClick: () => setShowDialog(false)
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--card)",
      borderRadius: "var(--radius-xl)",
      border: "1px solid var(--border)",
      padding: "28px 32px",
      width: "440px",
      boxShadow: "var(--shadow-xl)"
    },
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: "18px",
      fontWeight: 700,
      color: "var(--foreground)",
      margin: "0 0 20px"
    }
  }, "Add New User"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "14px"
    }
  }, [["Full name", "text", "Dr. Jane Smith"], ["Email", "email", "jane@ubc.ca"]].map(([label, type, ph]) => /*#__PURE__*/React.createElement("div", {
    key: label,
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "5px"
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: "13px",
      fontWeight: 500,
      color: "var(--foreground)"
    }
  }, label), /*#__PURE__*/React.createElement("input", {
    type: type,
    placeholder: ph,
    style: {
      padding: "8px 12px",
      fontSize: "13px",
      fontFamily: "var(--font-sans)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-base)",
      background: "var(--input)",
      color: "var(--foreground)",
      outline: "none"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "5px"
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: "13px",
      fontWeight: 500,
      color: "var(--foreground)"
    }
  }, "Role"), /*#__PURE__*/React.createElement("select", {
    style: {
      padding: "8px 12px",
      fontSize: "13px",
      fontFamily: "var(--font-sans)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-base)",
      background: "var(--input)",
      color: "var(--foreground)"
    }
  }, ["STUDENT", "TA", "PROFESSOR", "ADMIN"].map(r => /*#__PURE__*/React.createElement("option", {
    key: r,
    value: r
  }, ROLE_STYLE[r]?.label || r))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "10px",
      marginTop: "24px",
      justifyContent: "flex-end"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowDialog(false),
    style: {
      padding: "8px 18px",
      fontSize: "13px",
      fontWeight: 500,
      background: "transparent",
      color: "var(--foreground)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-base)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowDialog(false),
    style: {
      padding: "8px 18px",
      fontSize: "13px",
      fontWeight: 500,
      background: "var(--primary)",
      color: "var(--primary-foreground)",
      border: "none",
      borderRadius: "var(--radius-base)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, "Create User")))));
}
window.EduAIKit = window.EduAIKit || {};
window.EduAIKit.AdminUsers = AdminUsers;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/core/AdminUsers.jsx", error: String((e && e.message) || e) }); }

// ui_kits/core/Auth.jsx
try { (() => {
/* Auth.jsx — login + register with role demo selector */

const DEMO_USERS = [{
  name: "Alex Chen",
  email: "alex.chen@student.ubc.ca",
  role: "STUDENT",
  password: "demo"
}, {
  name: "Dr. Sarah Chen",
  email: "s.chen@ubc.ca",
  role: "PROFESSOR",
  password: "demo"
}, {
  name: "Tom Walker",
  email: "t.walker@ta.ubc.ca",
  role: "TA",
  password: "demo"
}, {
  name: "Dr. Sandra Hobbes",
  email: "s.hobbes@ubc.ca",
  role: "ADMIN",
  password: "demo"
}];
function Auth({
  onLogin
}) {
  const [mode, setMode] = React.useState("login"); // "login" | "register"
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const handleLogin = e => {
    if (e) e.preventDefault();
    setError("");
    if (!email || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);
    setTimeout(() => {
      const match = DEMO_USERS.find(u => u.email === email);
      if (match) {
        onLogin(match);
      } else {
        onLogin({
          name: email.split("@")[0],
          email,
          role: "STUDENT"
        });
      }
      setLoading(false);
    }, 700);
  };
  const handleDemoLogin = u => {
    setLoading(true);
    setTimeout(() => {
      onLogin(u);
      setLoading(false);
    }, 400);
  };
  const inputStyle = {
    width: "100%",
    padding: "9px 12px",
    fontSize: "14px",
    fontFamily: "var(--font-sans)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    background: "var(--background)",
    color: "var(--foreground)",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 150ms"
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "oklch(0.972 0.006 258)",
      fontFamily: "var(--font-sans)",
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      height: "3px",
      background: "#FFD100",
      zIndex: 10
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      marginBottom: "28px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "36px",
      height: "36px",
      borderRadius: "9px",
      background: "oklch(0.192 0.055 259)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "white",
    strokeWidth: "1.75",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "9"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 3a9 9 0 0 1 0 18"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M3 12h18"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 3c2 2 3.5 5.5 3.5 9s-1.5 7-3.5 9"
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "20px",
      fontWeight: 700,
      color: "oklch(0.192 0.055 259)",
      letterSpacing: "-0.01em"
    }
  }, "EduAI")), /*#__PURE__*/React.createElement("div", {
    style: {
      width: "100%",
      maxWidth: "440px",
      margin: "0 16px",
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-xl)",
      padding: "36px 32px",
      boxShadow: "0 4px 24px rgba(0,0,0,0.08)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      background: "var(--muted)",
      borderRadius: "var(--radius-lg)",
      padding: "3px",
      marginBottom: "24px"
    }
  }, [["login", "Sign in"], ["register", "Register"]].map(([m, label]) => /*#__PURE__*/React.createElement("button", {
    key: m,
    onClick: () => setMode(m),
    style: {
      flex: 1,
      padding: "7px",
      fontSize: "13.5px",
      fontWeight: mode === m ? 600 : 400,
      background: mode === m ? "#fff" : "transparent",
      color: mode === m ? "var(--foreground)" : "var(--muted-foreground)",
      border: "none",
      borderRadius: "var(--radius-md)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)",
      boxShadow: mode === m ? "0 1px 4px rgba(0,0,0,0.10)" : "none",
      transition: "all 150ms"
    }
  }, label))), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: "20px",
      fontWeight: 700,
      color: "var(--foreground)",
      margin: "0 0 4px"
    }
  }, mode === "login" ? "Welcome back" : "Create your account"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "13px",
      color: "var(--muted-foreground)",
      margin: "0 0 22px"
    }
  }, mode === "login" ? "Sign in to your UBC EduAI account." : "Get started with AI-powered learning."), /*#__PURE__*/React.createElement("form", {
    onSubmit: handleLogin,
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "14px"
    }
  }, mode === "register" && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "5px"
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: "13px",
      fontWeight: 500,
      color: "var(--foreground)"
    }
  }, "Full name"), /*#__PURE__*/React.createElement("input", {
    value: name,
    onChange: e => setName(e.target.value),
    placeholder: "Dr. Jane Smith",
    style: inputStyle
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "5px"
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: "13px",
      fontWeight: 500,
      color: "var(--foreground)"
    }
  }, "Email"), /*#__PURE__*/React.createElement("input", {
    type: "email",
    value: email,
    onChange: e => setEmail(e.target.value),
    placeholder: "you@ubc.ca",
    style: inputStyle
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "5px"
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: "13px",
      fontWeight: 500,
      color: "var(--foreground)"
    }
  }, "Password"), /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: password,
    onChange: e => setPassword(e.target.value),
    placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
    style: inputStyle
  })), error && /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "12px",
      color: "var(--destructive)",
      margin: 0
    }
  }, error), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    disabled: loading,
    style: {
      padding: "10px",
      fontSize: "14px",
      fontWeight: 600,
      background: loading ? "var(--muted)" : "oklch(0.192 0.055 259)",
      color: loading ? "var(--muted-foreground)" : "#fff",
      border: "none",
      borderRadius: "var(--radius-lg)",
      cursor: loading ? "not-allowed" : "pointer",
      fontFamily: "var(--font-sans)",
      minHeight: "44px",
      transition: "background 150ms"
    }
  }, loading ? "Signing in…" : mode === "login" ? "Sign in" : "Create account")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "24px",
      paddingTop: "20px",
      borderTop: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "11px",
      fontWeight: 600,
      color: "var(--muted-foreground)",
      textTransform: "uppercase",
      letterSpacing: "0.06em",
      marginBottom: "10px"
    }
  }, "Demo accounts"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "7px"
    }
  }, DEMO_USERS.map(u => /*#__PURE__*/React.createElement("button", {
    key: u.role,
    onClick: () => handleDemoLogin(u),
    disabled: loading,
    style: {
      padding: "8px 10px",
      fontSize: "12px",
      fontWeight: 500,
      textAlign: "left",
      background: "var(--muted)",
      color: "var(--foreground)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)",
      transition: "border-color 150ms"
    },
    onMouseEnter: e => e.currentTarget.style.borderColor = "oklch(0.192 0.055 259)",
    onMouseLeave: e => e.currentTarget.style.borderColor = "var(--border)"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 600
    }
  }, u.role === "PROFESSOR" ? "Prof." : u.role.charAt(0) + u.role.slice(1).toLowerCase()), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "10px",
      color: "var(--muted-foreground)",
      marginTop: "1px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, u.name)))))), /*#__PURE__*/React.createElement("p", {
    style: {
      marginTop: "20px",
      fontSize: "12px",
      color: "var(--muted-foreground)"
    }
  }, "University of British Columbia \xB7 EduAI Platform"));
}
window.EduAIKit = window.EduAIKit || {};
window.EduAIKit.Auth = Auth;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/core/Auth.jsx", error: String((e && e.message) || e) }); }

// ui_kits/core/Chat.jsx
try { (() => {
/* Chat.jsx — matches chat.tsx: model+course selectors in bottom bar, system prompt above */

const _CHAT_COURSES = [{
  code: "CPSC 110",
  name: "Computation, Programs, and Programming"
}, {
  code: "MATH 200",
  name: "Calculus III"
}, {
  code: "PHYS 101",
  name: "Energy and Waves"
}];
const _CHAT_MODELS = [{
  id: "openai:gpt-4o",
  name: "GPT-4o",
  provider: "OpenAI"
}, {
  id: "openai:gpt-4o-mini",
  name: "GPT-4o mini",
  provider: "OpenAI"
}, {
  id: "anthropic:claude-3-5-sonnet",
  name: "Claude 3.5 Sonnet",
  provider: "Anthropic"
}];
const _PROMPTS = [{
  text: "Explain tail recursion with an example",
  course: "CPSC 110"
}, {
  text: "What's the difference between partial and total derivatives?",
  course: "MATH 200"
}, {
  text: "How does the HtDF design recipe work?",
  course: "CPSC 110"
}, {
  text: "Summarise this week's lecture on energy",
  course: "PHYS 101"
}];
const _AI_RESPONSES = {
  default: "Great question! Based on the course materials, I can help explain that concept. In functional programming, this is a fundamental idea that builds on the design recipes we've been using throughout the course. Let me walk you through it step by step.\n\nFirst, let's consider what happens when a function calls itself — this is the essence of recursion. Tail recursion specifically refers to a recursive call that is the *last* operation the function performs before returning. This allows the compiler or interpreter to optimize the call by reusing the current stack frame.",
  "What's the difference between partial and total derivatives?": "Excellent question for MATH 200! Let's break this down clearly.\n\nA **partial derivative** treats all variables except one as constants and differentiates with respect to that single variable. If f(x, y) = x² + xy, then ∂f/∂x = 2x + y.\n\nA **total derivative** accounts for how *all* variables change simultaneously. It combines all partial derivatives weighted by how each variable changes.\n\nThe key distinction: partial derivatives are used when you want to measure sensitivity in one direction at a time, while total derivatives capture the full rate of change."
};
function Chat({
  user
}) {
  const [messages, setMessages] = React.useState([]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [course, setCourse] = React.useState(null);
  const [model, setModel] = React.useState(_CHAT_MODELS[0].id);
  const [showSysPrompt, setShowSysPrompt] = React.useState(false);
  const [showCourseDD, setShowCourseDD] = React.useState(false);
  const [showModelDD, setShowModelDD] = React.useState(false);
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);
  const send = text => {
    const q = text || input.trim();
    if (!q || loading) return;
    setInput("");
    setMessages(m => [...m, {
      role: "user",
      content: q
    }]);
    setLoading(true);
    setTimeout(() => {
      const reply = _AI_RESPONSES[q] || _AI_RESPONSES.default;
      setMessages(m => [...m, {
        role: "assistant",
        content: reply
      }]);
      setLoading(false);
    }, 1200);
  };
  const selectedModel = _CHAT_MODELS.find(m => m.id === model) || _CHAT_MODELS[0];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      fontFamily: "var(--font-sans)",
      background: "oklch(0.984 0.003 258)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: "56px",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      padding: "0 28px",
      justifyContent: "space-between",
      flexShrink: 0,
      background: "var(--background)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      fontSize: "13px",
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement("span", null, "Home"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--border)"
    }
  }, "/"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--foreground)",
      fontWeight: 500
    }
  }, "Chatbot"), course && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--border)"
    }
  }, "\xB7"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "oklch(0.192 0.055 259)",
      fontWeight: 500
    }
  }, course))), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowSysPrompt(v => !v),
    style: {
      display: "flex",
      alignItems: "center",
      gap: "5px",
      padding: "5px 11px",
      fontSize: "12px",
      fontWeight: 500,
      background: showSysPrompt ? "oklch(0.192 0.055 259)" : "var(--muted)",
      color: showSysPrompt ? "#fff" : "var(--muted-foreground)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)",
      transition: "all 150ms"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "13",
    height: "13",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4"
  })), "System Prompt")), showSysPrompt && /*#__PURE__*/React.createElement("div", {
    style: {
      borderBottom: "1px solid var(--border)",
      padding: "14px 28px",
      background: "var(--card)",
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: "12px",
      fontWeight: 600,
      color: "var(--muted-foreground)",
      display: "block",
      marginBottom: "6px"
    }
  }, "Custom System Prompt (optional)"), /*#__PURE__*/React.createElement("textarea", {
    placeholder: "Override the default AI system prompt for this session\u2026",
    rows: 2,
    style: {
      width: "100%",
      padding: "8px 12px",
      fontSize: "13px",
      fontFamily: "var(--font-sans)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      background: "var(--background)",
      color: "var(--foreground)",
      outline: "none",
      resize: "none",
      boxSizing: "border-box"
    }
  })), /*#__PURE__*/React.createElement("div", {
    ref: scrollRef,
    style: {
      flex: 1,
      overflowY: "auto",
      padding: "24px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "720px",
      margin: "0 auto",
      padding: "0 24px"
    }
  }, messages.length === 0 ?
  /*#__PURE__*/
  /* Welcome screen */
  React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "360px",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "64px",
      height: "64px",
      borderRadius: "16px",
      background: "oklch(0.192 0.055 259)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: "18px"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "30",
    height: "30",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "white",
    strokeWidth: "1.5",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 8V4M8 4h8M7 8h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9 13h.01M15 13h.01"
  }))), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: "20px",
      fontWeight: 700,
      color: "var(--foreground)",
      margin: "0 0 6px"
    }
  }, course ? `Chatting about ${course}` : "What would you like to know?"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "14px",
      color: "var(--muted-foreground)",
      margin: "0 0 24px",
      maxWidth: "380px",
      lineHeight: 1.6
    }
  }, course ? `Ask anything about your ${course} course materials — lectures, assignments, concepts.` : "Select a course below to ground your questions in specific materials, or ask anything."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "10px",
      width: "100%",
      maxWidth: "520px"
    }
  }, _PROMPTS.map((p, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    onClick: () => send(p.text),
    style: {
      padding: "12px 14px",
      fontSize: "13px",
      textAlign: "left",
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-xl)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)",
      color: "var(--foreground)",
      lineHeight: 1.4,
      transition: "border-color 150ms, box-shadow 150ms"
    },
    onMouseEnter: e => {
      e.currentTarget.style.borderColor = "oklch(0.192 0.055 259)";
      e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
    },
    onMouseLeave: e => {
      e.currentTarget.style.borderColor = "var(--border)";
      e.currentTarget.style.boxShadow = "none";
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "10px",
      fontWeight: 700,
      color: "oklch(0.47 0.17 258)",
      marginBottom: "4px"
    }
  }, p.course), p.text)))) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "18px"
    }
  }, messages.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      justifyContent: m.role === "user" ? "flex-end" : "flex-start"
    }
  }, m.role === "assistant" && /*#__PURE__*/React.createElement("div", {
    style: {
      width: "28px",
      height: "28px",
      borderRadius: "7px",
      background: "oklch(0.192 0.055 259)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      marginRight: "10px",
      marginTop: "2px"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "white",
    strokeWidth: "1.75",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 8V4M8 4h8M7 8h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9 13h.01M15 13h.01"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "80%",
      padding: "12px 16px",
      borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "4px 16px 16px 16px",
      background: m.role === "user" ? "oklch(0.192 0.055 259)" : "var(--card)",
      color: m.role === "user" ? "#fff" : "var(--foreground)",
      border: m.role === "user" ? "none" : "1px solid var(--border)",
      fontSize: "14px",
      lineHeight: 1.6,
      whiteSpace: "pre-wrap",
      boxShadow: m.role === "user" ? "none" : "0 1px 3px rgba(0,0,0,0.06)"
    }
  }, m.content))), loading && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "10px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "28px",
      height: "28px",
      borderRadius: "7px",
      background: "oklch(0.192 0.055 259)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "white",
    strokeWidth: "1.75",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 8V4M8 4h8M7 8h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9 13h.01M15 13h.01"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "12px 16px",
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "4px 16px 16px 16px",
      display: "flex",
      gap: "5px",
      alignItems: "center"
    }
  }, [0, 1, 2].map(i => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      width: "6px",
      height: "6px",
      borderRadius: "50%",
      background: "var(--muted-foreground)",
      animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`
    }
  }))))))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: "1px solid var(--border)",
      background: "var(--background)",
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "720px",
      margin: "0 auto",
      padding: "12px 24px 16px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "8px",
      marginBottom: "10px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setShowCourseDD(v => !v);
      setShowModelDD(false);
    },
    style: {
      display: "flex",
      alignItems: "center",
      gap: "5px",
      padding: "5px 11px",
      fontSize: "12px",
      fontWeight: 500,
      background: course ? "oklch(0.192 0.055 259)" : "var(--muted)",
      color: course ? "#fff" : "var(--muted-foreground)",
      border: "1px solid var(--border)",
      borderRadius: "999px",
      cursor: "pointer",
      fontFamily: "var(--font-sans)",
      transition: "all 150ms"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 19V7.5a3.5 3.5 0 0 1 7 0V19M11 7.5a3.5 3.5 0 0 1 7 0V19M4 19h16"
  })), course || "Select course", /*#__PURE__*/React.createElement("svg", {
    width: "10",
    height: "10",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M6 9l6 6 6-6"
  }))), showCourseDD && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      bottom: "calc(100% + 6px)",
      left: 0,
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      overflow: "hidden",
      zIndex: 50,
      minWidth: "220px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.12)"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setCourse(null);
      setShowCourseDD(false);
    },
    style: {
      width: "100%",
      padding: "9px 14px",
      fontSize: "13px",
      textAlign: "left",
      background: !course ? "oklch(0.192 0.055 259 / 0.07)" : "transparent",
      color: "var(--muted-foreground)",
      border: "none",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, "No course (general)"), _CHAT_COURSES.map(c => /*#__PURE__*/React.createElement("button", {
    key: c.code,
    onClick: () => {
      setCourse(c.code);
      setShowCourseDD(false);
    },
    style: {
      width: "100%",
      padding: "9px 14px",
      fontSize: "13px",
      textAlign: "left",
      background: course === c.code ? "oklch(0.192 0.055 259 / 0.07)" : "transparent",
      color: "var(--foreground)",
      border: "none",
      borderTop: "1px solid var(--border)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600
    }
  }, c.code), " \u2014 ", c.name.slice(0, 28), "\u2026")))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setShowModelDD(v => !v);
      setShowCourseDD(false);
    },
    style: {
      display: "flex",
      alignItems: "center",
      gap: "5px",
      padding: "5px 11px",
      fontSize: "12px",
      fontWeight: 500,
      background: "var(--muted)",
      color: "var(--muted-foreground)",
      border: "1px solid var(--border)",
      borderRadius: "999px",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 8V4M8 4h8M7 8h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9 13h.01M15 13h.01"
  })), selectedModel.name, /*#__PURE__*/React.createElement("svg", {
    width: "10",
    height: "10",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M6 9l6 6 6-6"
  }))), showModelDD && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      bottom: "calc(100% + 6px)",
      left: 0,
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      overflow: "hidden",
      zIndex: 50,
      minWidth: "200px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.12)"
    }
  }, _CHAT_MODELS.map(m => /*#__PURE__*/React.createElement("button", {
    key: m.id,
    onClick: () => {
      setModel(m.id);
      setShowModelDD(false);
    },
    style: {
      width: "100%",
      padding: "9px 14px",
      fontSize: "13px",
      textAlign: "left",
      background: model === m.id ? "oklch(0.192 0.055 259 / 0.07)" : "transparent",
      color: "var(--foreground)",
      border: "none",
      borderTop: m !== _CHAT_MODELS[0] ? "1px solid var(--border)" : "none",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600
    }
  }, m.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "11px",
      color: "var(--muted-foreground)",
      marginLeft: "5px"
    }
  }, m.provider)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "10px",
      alignItems: "flex-end"
    }
  }, /*#__PURE__*/React.createElement("textarea", {
    value: input,
    onChange: e => setInput(e.target.value),
    rows: 1,
    onKeyDown: e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    placeholder: course ? `Ask about ${course} materials…` : "Ask anything…",
    style: {
      flex: 1,
      padding: "10px 14px",
      fontSize: "14px",
      fontFamily: "var(--font-sans)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-xl)",
      background: "var(--background)",
      color: "var(--foreground)",
      outline: "none",
      resize: "none",
      lineHeight: 1.5,
      maxHeight: "120px",
      minHeight: "44px"
    },
    onInput: e => {
      e.target.style.height = "auto";
      e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => send(),
    disabled: !input.trim() || loading,
    style: {
      width: "44px",
      height: "44px",
      borderRadius: "var(--radius-xl)",
      flexShrink: 0,
      background: input.trim() && !loading ? "oklch(0.192 0.055 259)" : "var(--muted)",
      color: input.trim() && !loading ? "#fff" : "var(--muted-foreground)",
      border: "none",
      cursor: input.trim() && !loading ? "pointer" : "not-allowed",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "background 150ms"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "17",
    height: "17",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M22 2L11 13"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M22 2L15 22 11 13 2 9l20-7z"
  })))))), /*#__PURE__*/React.createElement("style", null, `@keyframes pulse { 0%,80%,100%{opacity:.3} 40%{opacity:1} }`));
}
window.EduAIKit = window.EduAIKit || {};
window.EduAIKit.Chat = Chat;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/core/Chat.jsx", error: String((e && e.message) || e) }); }

// ui_kits/core/CourseDetail.jsx
try { (() => {
/* CourseDetail.jsx — matches courses.$courseId.tsx: tabs = Overview / Materials / Chat */

const _CD_COURSE = {
  id: "1",
  code: "CPSC 110",
  name: "Computation, Programs, and Programming",
  term: "Fall",
  year: 2024,
  isActive: true,
  description: "Systematic program design using the functional core of a modern object-oriented language. Design recipes, abstraction, testing, and program decomposition.",
  aiInstructions: "Focus on functional programming concepts and design recipes. Emphasize HtDF and HtDW design patterns. Help students understand recursion and data-directed design.",
  professor: {
    name: "Prof. Gregor Kiczales",
    email: "kiczales@cs.ubc.ca"
  }
};
const _CD_MATERIALS = [{
  name: "Week 1 — Introduction to BSL.pdf",
  type: "pdf",
  size: "2.4 MB",
  date: "Sep 4",
  embedded: true
}, {
  name: "Week 2 — Data Definitions.pdf",
  type: "pdf",
  size: "3.1 MB",
  date: "Sep 11",
  embedded: true
}, {
  name: "Week 3 — How to Design Functions.pdf",
  type: "pdf",
  size: "1.9 MB",
  date: "Sep 18",
  embedded: true
}, {
  name: "Midterm Review Slides.pptx",
  type: "pptx",
  size: "5.6 MB",
  date: "Oct 2",
  embedded: false
}, {
  name: "Lab 1 — DrRacket Setup.pdf",
  type: "pdf",
  size: "0.8 MB",
  date: "Sep 6",
  embedded: true
}];
const CD_TABS = ["Overview", "Materials", "Chat"];
function CDSiteHeader({
  onBack,
  course
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: "56px",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      padding: "0 28px",
      justifyContent: "space-between",
      flexShrink: 0,
      background: "var(--background)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      fontSize: "13px",
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onBack,
    style: {
      background: "none",
      border: "none",
      cursor: "pointer",
      color: "var(--muted-foreground)",
      fontFamily: "var(--font-sans)",
      fontSize: "13px",
      padding: 0
    }
  }, "Home"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--border)"
    }
  }, "/"), /*#__PURE__*/React.createElement("button", {
    onClick: onBack,
    style: {
      background: "none",
      border: "none",
      cursor: "pointer",
      color: "var(--muted-foreground)",
      fontFamily: "var(--font-sans)",
      fontSize: "13px",
      padding: 0
    }
  }, "Courses"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--border)"
    }
  }, "/"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--foreground)",
      fontWeight: 500
    }
  }, course.code)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "8px"
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "5px",
      padding: "6px 13px",
      fontSize: "13px",
      fontWeight: 500,
      background: "transparent",
      color: "var(--foreground)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "13",
    height: "13",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "9",
    cy: "7",
    r: "4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
  })), "View Students")));
}
function CDTabBar({
  active,
  onSelect
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      borderBottom: "1px solid var(--border)",
      padding: "0 28px",
      background: "var(--background)",
      flexShrink: 0
    }
  }, CD_TABS.map(tab => /*#__PURE__*/React.createElement("button", {
    key: tab,
    onClick: () => onSelect(tab),
    style: {
      padding: "12px 18px",
      fontSize: "14px",
      fontWeight: active === tab ? 500 : 400,
      color: active === tab ? "var(--foreground)" : "var(--muted-foreground)",
      background: "none",
      border: "none",
      cursor: "pointer",
      borderBottom: active === tab ? "2px solid oklch(0.192 0.055 259)" : "2px solid transparent",
      marginBottom: "-1px",
      fontFamily: "var(--font-sans)",
      transition: "color 120ms"
    }
  }, tab)));
}
function CDOverview({
  user
}) {
  const c = _CD_COURSE;
  const canManage = user?.role === "ADMIN" || user?.role === "PROFESSOR";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "28px",
      display: "flex",
      flexDirection: "column",
      gap: "16px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "linear-gradient(135deg, oklch(0.192 0.055 259) 0%, oklch(0.42 0.14 232) 100%)",
      borderRadius: "var(--radius-xl)",
      padding: "24px 28px",
      color: "#fff"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "11px",
      opacity: 0.7,
      marginBottom: "5px",
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: "0.06em"
    }
  }, "CPSC \xB7 ", c.term, " ", c.year), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: "20px",
      fontWeight: 700,
      margin: "0 0 8px",
      lineHeight: 1.2
    }
  }, c.code, ": ", c.name), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "13px",
      opacity: 0.85,
      margin: 0,
      lineHeight: 1.55,
      maxWidth: "560px"
    }
  }, c.description), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "8px",
      marginTop: "16px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "11px",
      fontWeight: 600,
      padding: "3px 10px",
      borderRadius: "999px",
      background: "rgba(255,255,255,0.2)"
    }
  }, "\u25CF Active"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "11px",
      fontWeight: 600,
      padding: "3px 10px",
      borderRadius: "999px",
      background: "rgba(255,255,255,0.2)"
    }
  }, "AI-enabled"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "16px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-xl)",
      padding: "20px 22px"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: "14px",
      fontWeight: 600,
      color: "var(--foreground)",
      margin: "0 0 14px",
      display: "flex",
      alignItems: "center",
      gap: "7px"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "15",
    height: "15",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--primary)",
    strokeWidth: "1.75",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 19V7.5a3.5 3.5 0 0 1 7 0V19M11 7.5a3.5 3.5 0 0 1 7 0V19M4 19h16"
  })), "Course Information"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "12px"
    }
  }, [["Term", `${c.term} ${c.year}`], ["Status", c.isActive ? "Active" : "Inactive"]].map(([k, v]) => /*#__PURE__*/React.createElement("div", {
    key: k
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "12px",
      fontWeight: 600,
      color: "var(--muted-foreground)",
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      marginBottom: "2px"
    }
  }, k), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "14px",
      color: "var(--foreground)"
    }
  }, v))))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-xl)",
      padding: "20px 22px"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: "14px",
      fontWeight: 600,
      color: "var(--foreground)",
      margin: "0 0 14px",
      display: "flex",
      alignItems: "center",
      gap: "7px"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "15",
    height: "15",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--primary)",
    strokeWidth: "1.75",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "7",
    r: "4"
  })), "Instructor"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "11px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "40px",
      height: "40px",
      borderRadius: "9px",
      background: "oklch(0.192 0.055 259)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#fff",
      fontWeight: 700,
      fontSize: "14px",
      flexShrink: 0
    }
  }, "GK"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "14px",
      fontWeight: 600,
      color: "var(--foreground)"
    }
  }, c.professor.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "12px",
      color: "var(--muted-foreground)"
    }
  }, c.professor.email))))), c.aiInstructions && /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-xl)",
      padding: "20px 22px"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: "14px",
      fontWeight: 600,
      color: "var(--foreground)",
      margin: "0 0 10px",
      display: "flex",
      alignItems: "center",
      gap: "7px"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "15",
    height: "15",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--primary)",
    strokeWidth: "1.75",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 8V4M8 4h8M7 8h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9 13h.01M15 13h.01"
  })), "AI Instructions"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "13px",
      color: "var(--muted-foreground)",
      margin: 0,
      lineHeight: 1.6
    }
  }, c.aiInstructions)));
}
function CDMaterials({
  user
}) {
  const canManage = user?.role === "ADMIN" || user?.role === "PROFESSOR";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "28px"
    }
  }, canManage ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "16px"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: "16px",
      fontWeight: 600,
      color: "var(--foreground)",
      margin: "0 0 3px"
    }
  }, "Course Materials"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "13px",
      color: "var(--muted-foreground)",
      margin: 0
    }
  }, _CD_MATERIALS.length, " files \xB7 ", _CD_MATERIALS.filter(m => m.embedded).length, " embedded in AI")), /*#__PURE__*/React.createElement("button", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "7px",
      padding: "7px 14px",
      fontSize: "13px",
      fontWeight: 500,
      background: "oklch(0.192 0.055 259)",
      color: "#fff",
      border: "none",
      borderRadius: "var(--radius-lg)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "13",
    height: "13",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 5v14M5 12h14"
  })), "Upload File")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "8px"
    }
  }, _CD_MATERIALS.map((f, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      padding: "12px 16px",
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "32px",
      height: "32px",
      borderRadius: "7px",
      flexShrink: 0,
      background: f.type === "pdf" ? "oklch(0.63 0.22 25)" : "oklch(0.55 0.18 48)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "white",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M14 2v6h6M16 13H8M16 17H8M10 9H8"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "13px",
      fontWeight: 500,
      color: "var(--foreground)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, f.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "11px",
      color: "var(--muted-foreground)",
      marginTop: "2px"
    }
  }, f.size, " \xB7 Uploaded ", f.date)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "10px",
      fontWeight: 700,
      padding: "2px 8px",
      borderRadius: "999px",
      background: f.embedded ? "var(--color-success-100)" : "var(--muted)",
      color: f.embedded ? "var(--color-success-700)" : "var(--muted-foreground)"
    }
  }, f.embedded ? "Embedded" : "Not embedded"))))) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "60px 20px",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "56px",
      height: "56px",
      borderRadius: "14px",
      background: "var(--muted)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: "14px"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "26",
    height: "26",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--muted-foreground)",
    strokeWidth: "1.5",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 19V7.5a3.5 3.5 0 0 1 7 0V19M11 7.5a3.5 3.5 0 0 1 7 0V19M4 19h16"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "15px",
      fontWeight: 600,
      color: "var(--foreground)",
      marginBottom: "5px"
    }
  }, "Course materials are managed by your professor"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "13px",
      color: "var(--muted-foreground)",
      margin: 0
    }
  }, "Only professors and administrators can upload or manage course materials.")));
}
function CDChat({
  onNavigateToChatbot
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "60px 20px",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "60px",
      height: "60px",
      borderRadius: "14px",
      background: "oklch(0.192 0.055 259 / 0.08)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: "16px"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "28",
    height: "28",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "oklch(0.192 0.055 259)",
    strokeWidth: "1.5",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 8V4M8 4h8M7 8h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9 13h.01M15 13h.01"
  }))), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: "16px",
      fontWeight: 600,
      color: "var(--foreground)",
      margin: "0 0 8px"
    }
  }, "Chat about this course with AI"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "13px",
      color: "var(--muted-foreground)",
      maxWidth: "360px",
      lineHeight: 1.6,
      margin: "0 0 20px"
    }
  }, "Use the main Chatbot to ask questions about CPSC 110 materials. Select this course from the course selector in the chat input."), /*#__PURE__*/React.createElement("button", {
    onClick: onNavigateToChatbot,
    style: {
      padding: "9px 20px",
      fontSize: "13px",
      fontWeight: 500,
      background: "oklch(0.192 0.055 259)",
      color: "#fff",
      border: "none",
      borderRadius: "var(--radius-lg)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, "Go to Chatbot"));
}
function CourseDetail({
  onBack,
  onNavigateToChatbot,
  user
}) {
  const [tab, setTab] = React.useState("Overview");
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      fontFamily: "var(--font-sans)",
      background: "oklch(0.976 0 0)"
    }
  }, /*#__PURE__*/React.createElement(CDSiteHeader, {
    onBack: onBack,
    course: _CD_COURSE
  }), /*#__PURE__*/React.createElement(CDTabBar, {
    active: tab,
    onSelect: setTab
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: "auto"
    }
  }, tab === "Overview" && /*#__PURE__*/React.createElement(CDOverview, {
    user: user
  }), tab === "Materials" && /*#__PURE__*/React.createElement(CDMaterials, {
    user: user
  }), tab === "Chat" && /*#__PURE__*/React.createElement(CDChat, {
    onNavigateToChatbot: onNavigateToChatbot
  })));
}
window.EduAIKit = window.EduAIKit || {};
window.EduAIKit.CourseDetail = CourseDetail;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/core/CourseDetail.jsx", error: String((e && e.message) || e) }); }

// ui_kits/core/Courses.jsx
try { (() => {
/* Courses.jsx — faithful to courses.tsx: code/name/term/badge/role-actions + create dialog */

const _COURSES_DATA = [{
  id: "1",
  code: "CPSC 110",
  name: "Computation, Programs, and Programming",
  term: "Fall",
  year: 2024,
  isActive: true,
  professorId: "p1",
  aiInstructions: "Focus on functional programming concepts and design recipes. Emphasize HtDF and HtDW design patterns.",
  description: "Systematic program design using the functional core of a modern object-oriented language."
}, {
  id: "2",
  code: "MATH 200",
  name: "Calculus III",
  term: "Fall",
  year: 2024,
  isActive: true,
  professorId: "p2",
  aiInstructions: "Help students with multivariable calculus, partial derivatives, and vector fields.",
  description: "Sequences and series, partial derivatives, multiple integration, vector calculus."
}, {
  id: "3",
  code: "PHYS 101",
  name: "Energy and Waves",
  term: "Fall",
  year: 2024,
  isActive: false,
  professorId: "p3",
  aiInstructions: "",
  description: "Energy, momentum, oscillations, waves, and thermodynamics."
}, {
  id: "4",
  code: "CPSC 210",
  name: "Software Construction",
  term: "Winter",
  year: 2024,
  isActive: true,
  professorId: "p1",
  aiInstructions: "Focus on object-oriented design, design patterns, and software testing.",
  description: "Design, development, and analysis of robust software components."
}, {
  id: "5",
  code: "STAT 200",
  name: "Elementary Statistics",
  term: "Winter",
  year: 2024,
  isActive: true,
  professorId: "p4",
  aiInstructions: "",
  description: "Classical, nonparametric and robust inferences about means, variances, and analysis of variance."
}];
const _COURSE_COLORS = ["oklch(0.56 0.20 255)", "oklch(0.56 0.18 145)", "oklch(0.60 0.18 300)", "oklch(0.58 0.18 48)", "oklch(0.55 0.16 25)", "oklch(0.52 0.17 210)"];
const _courseColor = code => _COURSE_COLORS[[...code].reduce((h, c) => c.charCodeAt(0) + ((h << 5) - h), 0) & 7 % _COURSE_COLORS.length];
const _ROLE_ACTIONS = {
  ADMIN: ["edit", "delete"],
  PROFESSOR: ["edit"],
  TA: ["view"],
  STUDENT: ["view"]
};
function CoursesSiteHeader({
  role,
  onAdd
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: "56px",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      padding: "0 28px",
      justifyContent: "space-between",
      flexShrink: 0,
      background: "var(--background)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      fontSize: "13px",
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement("span", null, "Home"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--border)"
    }
  }, "/"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--foreground)",
      fontWeight: 500
    }
  }, "Courses")), role === "ADMIN" && /*#__PURE__*/React.createElement("button", {
    onClick: onAdd,
    style: {
      display: "flex",
      alignItems: "center",
      gap: "7px",
      padding: "7px 14px",
      fontSize: "13px",
      fontWeight: 500,
      background: "oklch(0.192 0.055 259)",
      color: "#fff",
      border: "none",
      borderRadius: "var(--radius-lg)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 5v14M5 12h14"
  })), "Create Course"));
}
function CourseCard({
  course,
  role,
  myId,
  onView
}) {
  const actions = _ROLE_ACTIONS[role] || ["view"];
  const isProfOwn = role === "PROFESSOR" && course.professorId === "p1"; /* demo: p1 = logged-in prof */
  const showEdit = actions.includes("edit") && (role === "ADMIN" || isProfOwn);
  const showDelete = actions.includes("delete");
  const color = _courseColor(course.code);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onView,
    style: {
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-xl)",
      overflow: "hidden",
      cursor: "pointer",
      transition: "box-shadow 150ms, transform 150ms",
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)"
    },
    onMouseEnter: e => {
      e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.10)";
      e.currentTarget.style.transform = "translateY(-1px)";
    },
    onMouseLeave: e => {
      e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)";
      e.currentTarget.style.transform = "none";
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: "4px",
      background: color
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "16px 18px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      marginBottom: "8px"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "16px",
      fontWeight: 700,
      color: "var(--foreground)"
    }
  }, course.code), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "13px",
      color: "var(--muted-foreground)",
      marginTop: "2px",
      lineHeight: 1.3
    }
  }, course.name)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "6px",
      flexShrink: 0,
      marginLeft: "10px"
    },
    onClick: e => e.stopPropagation()
  }, showEdit && /*#__PURE__*/React.createElement("button", {
    style: {
      width: "30px",
      height: "30px",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
      background: "transparent",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "13",
    height: "13",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--muted-foreground)",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
  }))), showDelete && /*#__PURE__*/React.createElement("button", {
    style: {
      width: "30px",
      height: "30px",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
      background: "transparent",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "13",
    height: "13",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--destructive)",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("polyline", {
    points: "3 6 5 6 21 6"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M10 11v6M14 11v6"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"
  }))), !showEdit && !showDelete && /*#__PURE__*/React.createElement("button", {
    style: {
      width: "30px",
      height: "30px",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
      background: "transparent",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "13",
    height: "13",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--muted-foreground)",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      marginTop: "10px",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "4px",
      fontSize: "12px",
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "4",
    width: "18",
    height: "18",
    rx: "2",
    ry: "2"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "16",
    y1: "2",
    x2: "16",
    y2: "6"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "8",
    y1: "2",
    x2: "8",
    y2: "6"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "3",
    y1: "10",
    x2: "21",
    y2: "10"
  })), course.term, " ", course.year), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "11px",
      fontWeight: 600,
      padding: "2px 8px",
      borderRadius: "999px",
      background: course.isActive ? "var(--color-success-100)" : "var(--muted)",
      color: course.isActive ? "var(--color-success-700)" : "var(--muted-foreground)"
    }
  }, course.isActive ? "Active" : "Inactive")), course.aiInstructions && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "10px",
      padding: "8px 10px",
      background: "var(--muted)",
      borderRadius: "var(--radius-md)",
      fontSize: "11px",
      color: "var(--muted-foreground)",
      lineHeight: 1.5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600
    }
  }, "AI: "), course.aiInstructions.length > 80 ? course.aiInstructions.slice(0, 80) + "…" : course.aiInstructions)));
}
function Courses({
  user,
  onNavigate
}) {
  const role = user?.role || "STUDENT";
  const [showCreate, setShowCreate] = React.useState(false);
  const subtitle = role === "ADMIN" ? "Manage all courses in the system" : role === "PROFESSOR" ? "View and manage your courses" : "View your enrolled courses";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      fontFamily: "var(--font-sans)",
      background: "oklch(0.976 0 0)"
    }
  }, /*#__PURE__*/React.createElement(CoursesSiteHeader, {
    role: role,
    onAdd: () => setShowCreate(true)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: "auto",
      padding: "28px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: "20px"
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: "24px",
      fontWeight: 700,
      color: "var(--foreground)",
      margin: "0 0 5px"
    }
  }, "Courses"), /*#__PURE__*/React.createElement("div", {
    style: {
      width: "32px",
      height: "3px",
      background: "#FFD100",
      borderRadius: "2px",
      marginBottom: "8px"
    }
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "13px",
      color: "var(--muted-foreground)",
      margin: 0
    }
  }, subtitle)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: "16px"
    }
  }, _COURSES_DATA.map(c => /*#__PURE__*/React.createElement(CourseCard, {
    key: c.id,
    course: c,
    role: role,
    onView: () => onNavigate("courseDetail")
  })))), showCreate && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.45)",
      zIndex: 50,
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    },
    onClick: () => setShowCreate(false)
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--card)",
      borderRadius: "var(--radius-xl)",
      border: "1px solid var(--border)",
      padding: "28px 32px",
      width: "460px",
      boxShadow: "0 16px 48px rgba(0,0,0,0.18)"
    },
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: "18px",
      fontWeight: 700,
      color: "var(--foreground)",
      margin: "0 0 4px"
    }
  }, "Create New Course"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "13px",
      color: "var(--muted-foreground)",
      margin: "0 0 20px"
    }
  }, "Create a new course for the current academic term."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "14px"
    }
  }, [["Course Name", "text", "Introduction to Computer Science"], ["Course Code", "text", "CS 101"]].map(([label, type, ph]) => /*#__PURE__*/React.createElement("div", {
    key: label,
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "5px"
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: "13px",
      fontWeight: 500,
      color: "var(--foreground)"
    }
  }, label), /*#__PURE__*/React.createElement("input", {
    type: type,
    placeholder: ph,
    style: {
      padding: "8px 12px",
      fontSize: "13px",
      fontFamily: "var(--font-sans)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      background: "var(--background)",
      color: "var(--foreground)",
      outline: "none"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "12px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "5px"
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: "13px",
      fontWeight: 500,
      color: "var(--foreground)"
    }
  }, "Term"), /*#__PURE__*/React.createElement("select", {
    style: {
      padding: "8px 12px",
      fontSize: "13px",
      fontFamily: "var(--font-sans)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      background: "var(--background)",
      color: "var(--foreground)"
    }
  }, ["Fall", "Winter", "Summer"].map(t => /*#__PURE__*/React.createElement("option", {
    key: t
  }, t)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "5px"
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: "13px",
      fontWeight: 500,
      color: "var(--foreground)"
    }
  }, "Year"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    defaultValue: 2024,
    style: {
      padding: "8px 12px",
      fontSize: "13px",
      fontFamily: "var(--font-sans)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      background: "var(--background)",
      color: "var(--foreground)",
      outline: "none"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "5px"
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: "13px",
      fontWeight: 500,
      color: "var(--foreground)"
    }
  }, "AI Instructions"), /*#__PURE__*/React.createElement("textarea", {
    placeholder: "Instructions for AI assistant behavior in this course\u2026",
    rows: 3,
    style: {
      padding: "8px 12px",
      fontSize: "13px",
      fontFamily: "var(--font-sans)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      background: "var(--background)",
      color: "var(--foreground)",
      outline: "none",
      resize: "vertical"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "10px",
      marginTop: "22px",
      justifyContent: "flex-end"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowCreate(false),
    style: {
      padding: "8px 18px",
      fontSize: "13px",
      fontWeight: 500,
      background: "transparent",
      color: "var(--foreground)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowCreate(false),
    style: {
      padding: "8px 18px",
      fontSize: "13px",
      fontWeight: 500,
      background: "oklch(0.192 0.055 259)",
      color: "#fff",
      border: "none",
      borderRadius: "var(--radius-lg)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, "Create Course")))));
}
window.EduAIKit = window.EduAIKit || {};
window.EduAIKit.Courses = Courses;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/core/Courses.jsx", error: String((e && e.message) || e) }); }

// ui_kits/core/Dashboard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Dashboard.jsx — rich 2-col layout, hero, stats, course shortcuts, activity */

const _DASH_COURSES = [{
  code: "CPSC 110",
  name: "Computation, Programs, and Programming",
  term: "Fall 2024",
  professor: "Prof. G. Kiczales",
  color: "oklch(0.56 0.20 255)"
}, {
  code: "MATH 200",
  name: "Calculus III",
  term: "Fall 2024",
  professor: "Prof. A. Thompson",
  color: "oklch(0.56 0.18 145)"
}, {
  code: "PHYS 101",
  name: "Energy and Waves",
  term: "Fall 2024",
  professor: "Prof. L. Zhang",
  color: "oklch(0.60 0.18 300)"
}];
const _CONVOS = [{
  course: "CPSC 110",
  q: "What is tail recursion and why is it important for functional programming?",
  ago: "2h ago"
}, {
  course: "MATH 200",
  q: "Explain the gradient theorem and when to apply it",
  ago: "Yesterday"
}, {
  course: "CPSC 110",
  q: "How do I implement a binary search tree in Racket?",
  ago: "2 days ago"
}];
const _ADMIN_STATS = [{
  label: "Total Users",
  value: "1,248",
  trend: "+12",
  up: true
}, {
  label: "Active Courses",
  value: "47",
  trend: "+3",
  up: true
}, {
  label: "AI Sessions",
  value: "8,391",
  trend: "+24%",
  up: true
}, {
  label: "Storage Used",
  value: "12.4 GB",
  trend: "+5%",
  up: true
}];
const _PROF_STATS = [{
  label: "Courses Teaching",
  value: "3",
  trend: "",
  up: true
}, {
  label: "Students Enrolled",
  value: "312",
  trend: "+18",
  up: true
}, {
  label: "Materials Uploaded",
  value: "24",
  trend: "+6",
  up: true
}, {
  label: "AI Interactions",
  value: "891",
  trend: "+33%",
  up: true
}];
const _STUDENT_STATS = [{
  label: "Courses Enrolled",
  value: "3",
  trend: "",
  up: true
}, {
  label: "AI Sessions / Week",
  value: "12",
  trend: "+33%",
  up: true
}, {
  label: "Materials Accessed",
  value: "47",
  trend: "+8%",
  up: true
}, {
  label: "Avg. Quiz Score",
  value: "84%",
  trend: "-2%",
  up: false
}];
function DashSiteHeader({
  breadcrumbs
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: "56px",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      padding: "0 28px",
      justifyContent: "space-between",
      flexShrink: 0,
      background: "var(--background)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      fontSize: "13px",
      color: "var(--muted-foreground)"
    }
  }, breadcrumbs.map((b, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, i > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--border)"
    }
  }, "/"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: i === breadcrumbs.length - 1 ? "var(--foreground)" : undefined,
      fontWeight: i === breadcrumbs.length - 1 ? 500 : 400
    }
  }, b)))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "11px",
      fontWeight: 600,
      padding: "3px 10px",
      borderRadius: "999px",
      background: "oklch(0.192 0.055 259)",
      color: "#fff",
      letterSpacing: "0.02em"
    }
  }, "UBC \xB7 Student Portal"));
}
function StatCard({
  label,
  value,
  trend,
  up
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-xl)",
      padding: "18px 20px",
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "12px",
      color: "var(--muted-foreground)",
      marginBottom: "8px",
      fontWeight: 500
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "26px",
      fontWeight: 700,
      color: "var(--foreground)",
      lineHeight: 1
    }
  }, value), trend && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "8px",
      display: "inline-flex",
      alignItems: "center",
      gap: "3px",
      fontSize: "11px",
      fontWeight: 600,
      padding: "2px 7px",
      borderRadius: "999px",
      background: up ? "var(--color-success-100)" : "var(--color-error-100)",
      color: up ? "var(--color-success-700)" : "var(--color-error-700)"
    }
  }, up ? "↑" : "↓", " ", trend));
}
function Dashboard({
  user,
  onNavigate
}) {
  const role = user?.role || "STUDENT";
  const name = (user?.name || "").split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const stats = role === "ADMIN" ? _ADMIN_STATS : role === "PROFESSOR" ? _PROF_STATS : _STUDENT_STATS;
  const heroTitle = role === "ADMIN" ? "Platform Overview" : role === "PROFESSOR" ? `Welcome back, ${name}.` : `${greeting}, ${name}.`;
  const heroSub = role === "ADMIN" ? "EduAI platform health and usage at a glance." : role === "PROFESSOR" ? "Your courses and teaching activity." : "Your AI-powered learning companion.";
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      fontFamily: "var(--font-sans)",
      background: "oklch(0.976 0 0)"
    }
  }, /*#__PURE__*/React.createElement(DashSiteHeader, {
    breadcrumbs: ["Home", "Dashboard"]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: "auto",
      padding: "28px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: "24px"
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: "28px",
      fontWeight: 700,
      color: "var(--foreground)",
      margin: "0 0 10px",
      lineHeight: 1.1
    }
  }, heroTitle), /*#__PURE__*/React.createElement("div", {
    style: {
      width: "40px",
      height: "3px",
      background: "#FFD100",
      borderRadius: "2px",
      marginBottom: "10px"
    }
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "14px",
      color: "var(--muted-foreground)",
      margin: 0
    }
  }, dateStr, " \xB7 ", heroSub)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: "14px",
      marginBottom: "24px"
    }
  }, stats.map(s => /*#__PURE__*/React.createElement(StatCard, _extends({
    key: s.label
  }, s)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 380px",
      gap: "20px"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: "14px"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: "15px",
      fontWeight: 600,
      color: "var(--foreground)",
      margin: 0
    }
  }, role === "ADMIN" ? "Quick Actions" : "Your Courses"), role !== "ADMIN" && /*#__PURE__*/React.createElement("button", {
    onClick: () => onNavigate("courses"),
    style: {
      fontSize: "12px",
      color: "oklch(0.47 0.17 258)",
      fontWeight: 500,
      background: "none",
      border: "none",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, "Browse all \u2192")), role === "ADMIN" ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "12px"
    }
  }, [{
    label: "Add User",
    desc: "Create a new user account",
    icon: "users",
    action: "admin-users",
    color: "oklch(0.56 0.20 255)"
  }, {
    label: "Create Course",
    desc: "Set up a new course with AI",
    icon: "books",
    action: "courses",
    color: "oklch(0.56 0.18 145)"
  }, {
    label: "AI Settings",
    desc: "Manage models and providers",
    icon: "brain",
    action: "admin-ai",
    color: "oklch(0.60 0.18 300)"
  }, {
    label: "View Reports",
    desc: "Bug reports and system logs",
    icon: "report",
    action: "reports",
    color: "oklch(0.58 0.18 48)"
  }].map(a => /*#__PURE__*/React.createElement("button", {
    key: a.label,
    onClick: () => onNavigate(a.action),
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: "12px",
      padding: "16px",
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-xl)",
      cursor: "pointer",
      boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      textAlign: "left",
      fontFamily: "var(--font-sans)",
      transition: "box-shadow 150ms"
    },
    onMouseEnter: e => e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.10)",
    onMouseLeave: e => e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.05)"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "36px",
      height: "36px",
      borderRadius: "8px",
      background: a.color + "22",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: a.color,
    strokeWidth: "1.75",
    strokeLinecap: "round"
  }, (_SB_ICONS_DASH[a.icon] || []).map((d, i) => /*#__PURE__*/React.createElement("path", {
    key: i,
    d: d
  })))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "13px",
      fontWeight: 600,
      color: "var(--foreground)"
    }
  }, a.label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "12px",
      color: "var(--muted-foreground)",
      marginTop: "2px",
      lineHeight: 1.4
    }
  }, a.desc))))) : /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-xl)",
      overflow: "hidden",
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)"
    }
  }, _DASH_COURSES.map((c, i) => /*#__PURE__*/React.createElement("div", {
    key: c.code,
    style: {
      display: "flex",
      alignItems: "center",
      gap: "14px",
      padding: "14px 18px",
      borderBottom: i < _DASH_COURSES.length - 1 ? "1px solid var(--border)" : "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "4px",
      height: "44px",
      borderRadius: "2px",
      background: c.color,
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "8px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "14px",
      fontWeight: 600,
      color: "var(--foreground)"
    }
  }, c.code), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "11px",
      color: "var(--muted-foreground)"
    }
  }, c.term)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "12px",
      color: "var(--muted-foreground)",
      marginTop: "2px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, c.name)), /*#__PURE__*/React.createElement("button", {
    onClick: () => onNavigate("chatbot"),
    style: {
      padding: "6px 12px",
      fontSize: "12px",
      fontWeight: 500,
      background: "oklch(0.192 0.055 259)",
      color: "#fff",
      border: "none",
      borderRadius: "var(--radius-md)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)",
      whiteSpace: "nowrap"
    }
  }, "Chat \u2192"))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: "14px"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: "15px",
      fontWeight: 600,
      color: "var(--foreground)",
      margin: 0
    }
  }, "Recent Conversations"), /*#__PURE__*/React.createElement("button", {
    onClick: () => onNavigate("chatbot"),
    style: {
      fontSize: "12px",
      color: "oklch(0.47 0.17 258)",
      fontWeight: 500,
      background: "none",
      border: "none",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, "New chat \u2192")), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-xl)",
      overflow: "hidden",
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)"
    }
  }, _CONVOS.map((c, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      padding: "14px 18px",
      borderBottom: i < _CONVOS.length - 1 ? "1px solid var(--border)" : "none",
      cursor: "pointer"
    },
    onMouseEnter: e => e.currentTarget.style.background = "oklch(0.976 0 0)",
    onMouseLeave: e => e.currentTarget.style.background = "transparent"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "5px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "11px",
      fontWeight: 700,
      color: "oklch(0.192 0.055 259)",
      padding: "1px 7px",
      borderRadius: "999px",
      background: "oklch(0.192 0.055 259 / 0.08)"
    }
  }, c.course), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "11px",
      color: "var(--muted-foreground)"
    }
  }, c.ago)), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "13px",
      color: "var(--foreground)",
      margin: 0,
      lineHeight: 1.4,
      display: "-webkit-box",
      WebkitLineClamp: 2,
      WebkitBoxOrient: "vertical",
      overflow: "hidden"
    }
  }, "\"", c.q, "\""))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "12px 18px",
      background: "oklch(0.976 0 0)"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onNavigate("chatbot"),
    style: {
      fontSize: "13px",
      fontWeight: 500,
      color: "oklch(0.192 0.055 259)",
      background: "none",
      border: "none",
      cursor: "pointer",
      fontFamily: "var(--font-sans)",
      padding: 0
    }
  }, "+ Start a new conversation")))))));
}

/* icon paths used by admin quick-action cards */
const _SB_ICONS_DASH = {
  users: ["M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M23 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  books: ["M4 19V7.5a3.5 3.5 0 0 1 7 0V19", "M11 7.5a3.5 3.5 0 0 1 7 0V19", "M4 19h16"],
  brain: ["M9.5 2a2.5 2.5 0 1 1 5 0", "M4 9.5a2.5 2.5 0 1 1 5 0", "M15 9.5a2.5 2.5 0 1 1 5 0", "M12 4.5v5", "M6.5 12l3.5-2.5", "M17.5 12l-3.5-2.5", "M6.5 12a5.5 5.5 0 0 0 11 0"],
  report: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M16 13H8", "M16 17H8", "M10 9H8"]
};
window.EduAIKit = window.EduAIKit || {};
window.EduAIKit.Dashboard = Dashboard;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/core/Dashboard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/core/Onboarding.jsx
try { (() => {
/* Onboarding.jsx — student ID linking flow (/onboarding/student-id) */

function Onboarding({
  user,
  onComplete
}) {
  const [step, setStep] = React.useState("link"); // "link" | "success"
  const [studentId, setStudentId] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const handleSubmit = e => {
    e.preventDefault();
    if (!studentId.match(/^\d{8}$/)) {
      setError("Please enter a valid 8-digit UBC student number.");
      return;
    }
    setError("");
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setStep("success");
    }, 1100);
  };
  const handleSkip = () => onComplete();
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--color-blue-50)",
      fontFamily: "var(--font-sans)",
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      height: "3px",
      background: "var(--gold)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      top: "16px",
      left: "24px",
      display: "flex",
      alignItems: "center",
      gap: "8px"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "22",
    height: "22",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--primary)",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "9"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 3a9 9 0 0 1 0 18"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M3 12h18"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 3c2 2 3.5 5.5 3.5 9s-1.5 7-3.5 9"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "15px",
      fontWeight: 700,
      color: "var(--primary)"
    }
  }, "EduAI")), step === "link" ? /*#__PURE__*/React.createElement("div", {
    style: {
      width: "100%",
      maxWidth: "460px",
      margin: "0 16px",
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-xl)",
      padding: "40px 36px",
      boxShadow: "var(--shadow-lg)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      marginBottom: "28px"
    }
  }, [1, 2].map(n => /*#__PURE__*/React.createElement(React.Fragment, {
    key: n
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "24px",
      height: "24px",
      borderRadius: "50%",
      flexShrink: 0,
      background: n === 1 ? "var(--primary)" : "var(--muted)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "11px",
      fontWeight: 700,
      color: n === 1 ? "#fff" : "var(--muted-foreground)"
    }
  }, n), n < 2 && /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: "2px",
      background: "var(--border)"
    }
  })))), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: "22px",
      fontWeight: 700,
      color: "var(--foreground)",
      margin: "0 0 8px"
    }
  }, "Link your UBC student number"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "14px",
      color: "var(--muted-foreground)",
      margin: "0 0 24px",
      lineHeight: 1.6
    }
  }, "We use your student number to match your account with Canvas enrolment data. This lets us sync the courses you're registered in."), /*#__PURE__*/React.createElement("form", {
    onSubmit: handleSubmit,
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "16px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "5px"
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: "13px",
      fontWeight: 500,
      color: "var(--foreground)"
    }
  }, "UBC Student Number"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    inputMode: "numeric",
    value: studentId,
    onChange: e => setStudentId(e.target.value.replace(/\D/g, "").slice(0, 8)),
    placeholder: "e.g. 12345678",
    disabled: loading,
    style: {
      padding: "9px 12px",
      fontSize: "18px",
      fontFamily: "var(--font-mono)",
      border: `1px solid ${error ? "var(--destructive)" : "var(--border)"}`,
      borderRadius: "var(--radius-md)",
      background: "var(--input)",
      color: "var(--foreground)",
      outline: "none",
      letterSpacing: "0.1em"
    }
  }), error && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "12px",
      color: "var(--destructive)"
    }
  }, error), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "12px",
      color: "var(--muted-foreground)"
    }
  }, "Your 8-digit student number, found on your UBC Card or SSC.")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "12px 14px",
      background: "var(--color-blue-50)",
      borderRadius: "var(--radius-base)",
      border: "1px solid var(--color-blue-100)",
      display: "flex",
      gap: "10px"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--secondary)",
    strokeWidth: "2",
    strokeLinecap: "round",
    style: {
      flexShrink: 0,
      marginTop: "1px"
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 8v4M12 16h.01"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "12px",
      color: "var(--secondary)",
      lineHeight: 1.5
    }
  }, "Your student number is only used to match Canvas enrolments. It's stored securely and never shared.")), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    disabled: loading || studentId.length !== 8,
    style: {
      padding: "10px",
      fontSize: "14px",
      fontWeight: 500,
      background: loading || studentId.length !== 8 ? "var(--muted)" : "var(--primary)",
      color: loading || studentId.length !== 8 ? "var(--muted-foreground)" : "var(--primary-foreground)",
      border: "none",
      borderRadius: "var(--radius-base)",
      cursor: loading || studentId.length !== 8 ? "not-allowed" : "pointer",
      fontFamily: "var(--font-sans)",
      minHeight: "44px",
      transition: "background 150ms"
    }
  }, loading ? "Verifying…" : "Link student number"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: handleSkip,
    style: {
      padding: "8px",
      fontSize: "13px",
      color: "var(--muted-foreground)",
      background: "transparent",
      border: "none",
      cursor: "pointer",
      fontFamily: "var(--font-sans)",
      textDecoration: "underline",
      textUnderlineOffset: "3px"
    }
  }, "Skip for now \u2014 I'll do this later"))) :
  /*#__PURE__*/
  /* Success state */
  React.createElement("div", {
    style: {
      width: "100%",
      maxWidth: "420px",
      margin: "0 16px",
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-xl)",
      padding: "48px 36px",
      boxShadow: "var(--shadow-lg)",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "64px",
      height: "64px",
      borderRadius: "50%",
      margin: "0 auto 20px",
      background: "var(--color-success-100)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "30",
    height: "30",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--color-success-600)",
    strokeWidth: "2.5",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M20 6L9 17l-5-5"
  }))), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: "22px",
      fontWeight: 700,
      color: "var(--foreground)",
      margin: "0 0 8px"
    }
  }, "All set!"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "14px",
      color: "var(--muted-foreground)",
      margin: "0 0 28px",
      lineHeight: 1.6
    }
  }, "Student number ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "var(--foreground)",
      fontFamily: "var(--font-mono)"
    }
  }, studentId), " linked successfully. Your Canvas courses will sync automatically."), /*#__PURE__*/React.createElement("button", {
    onClick: onComplete,
    style: {
      width: "100%",
      padding: "10px",
      fontSize: "14px",
      fontWeight: 500,
      background: "var(--primary)",
      color: "var(--primary-foreground)",
      border: "none",
      borderRadius: "var(--radius-base)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)",
      minHeight: "44px"
    }
  }, "Go to Dashboard")));
}
window.EduAIKit = window.EduAIKit || {};
window.EduAIKit.Onboarding = Onboarding;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/core/Onboarding.jsx", error: String((e && e.message) || e) }); }

// ui_kits/core/Settings.jsx
try { (() => {
/* Settings.jsx — tabbed settings page: API Keys · Canvas */

const SETTINGS_TABS = ["API Keys", "Canvas"];
const API_KEYS = [{
  name: "Bench testing key",
  prefix: "ba_live_••••••••••••",
  created: "May 12, 2025",
  lastUsed: "Jun 10, 2025"
}, {
  name: "CI pipeline key",
  prefix: "ba_live_••••••••••••",
  created: "Apr 3, 2025",
  lastUsed: "Jun 11, 2025"
}];
function SettingsSiteHeader() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: "56px",
      borderBottom: "1px solid var(--border)",
      flexShrink: 0,
      display: "flex",
      alignItems: "center",
      padding: "0 24px",
      background: "var(--background)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      fontSize: "13px",
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement("span", null, "Home"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--border)"
    }
  }, "/"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--foreground)",
      fontWeight: 500
    }
  }, "Settings")));
}
function SettingsTabBar({
  active,
  onSelect
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      borderBottom: "1px solid var(--border)",
      padding: "0 24px",
      background: "var(--background)",
      flexShrink: 0
    }
  }, SETTINGS_TABS.map(tab => /*#__PURE__*/React.createElement("button", {
    key: tab,
    onClick: () => onSelect(tab),
    style: {
      padding: "12px 16px",
      fontSize: "14px",
      fontWeight: active === tab ? 500 : 400,
      color: active === tab ? "var(--foreground)" : "var(--muted-foreground)",
      background: "none",
      border: "none",
      cursor: "pointer",
      borderBottom: active === tab ? "2px solid var(--primary)" : "2px solid transparent",
      marginBottom: "-1px",
      fontFamily: "var(--font-sans)",
      transition: "color 120ms"
    }
  }, tab)));
}
function ApiKeysTab() {
  const [showCreate, setShowCreate] = React.useState(false);
  const [keyName, setKeyName] = React.useState("");
  const [copied, setCopied] = React.useState(null);
  const handleCopy = i => {
    setCopied(i);
    setTimeout(() => setCopied(null), 1800);
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "28px 24px",
      maxWidth: "720px",
      display: "flex",
      flexDirection: "column",
      gap: "24px"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: "18px",
      fontWeight: 600,
      color: "var(--foreground)",
      margin: "0 0 6px"
    }
  }, "API Keys"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "14px",
      color: "var(--muted-foreground)",
      margin: 0,
      lineHeight: 1.5
    }
  }, "Create API keys for programmatic access to EduAI. Keys are shown once on creation \u2014 store them securely.")), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "16px 20px",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "14px",
      fontWeight: 600,
      color: "var(--foreground)"
    }
  }, "Create new key"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowCreate(v => !v),
    style: {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "6px 13px",
      fontSize: "13px",
      fontWeight: 500,
      background: showCreate ? "var(--muted)" : "var(--primary)",
      color: showCreate ? "var(--foreground)" : "var(--primary-foreground)",
      border: "none",
      borderRadius: "var(--radius-base)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "13",
    height: "13",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 5v14M5 12h14"
  })), showCreate ? "Cancel" : "New key")), showCreate && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "16px 20px",
      display: "flex",
      gap: "10px"
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: keyName,
    onChange: e => setKeyName(e.target.value),
    placeholder: "Key name (e.g. Bench testing)",
    style: {
      flex: 1,
      padding: "8px 12px",
      fontSize: "13px",
      fontFamily: "var(--font-sans)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-base)",
      background: "var(--input)",
      color: "var(--foreground)",
      outline: "none"
    }
  }), /*#__PURE__*/React.createElement("button", {
    style: {
      padding: "8px 16px",
      fontSize: "13px",
      fontWeight: 500,
      background: "var(--primary)",
      color: "var(--primary-foreground)",
      border: "none",
      borderRadius: "var(--radius-base)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, "Create"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "0"
    }
  }, API_KEYS.map((k, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      alignItems: "center",
      gap: "14px",
      padding: "14px 18px",
      background: "var(--card)",
      borderTop: i === 0 ? "1px solid var(--border)" : "none",
      borderLeft: "1px solid var(--border)",
      borderRight: "1px solid var(--border)",
      borderBottom: "1px solid var(--border)",
      borderRadius: i === 0 ? "var(--radius-lg) var(--radius-lg) 0 0" : i === API_KEYS.length - 1 ? "0 0 var(--radius-lg) var(--radius-lg)" : "0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "36px",
      height: "36px",
      borderRadius: "8px",
      flexShrink: 0,
      background: "var(--color-blue-50)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--primary)",
    strokeWidth: "1.75",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "14px",
      fontWeight: 500,
      color: "var(--foreground)"
    }
  }, k.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "12px",
      color: "var(--muted-foreground)",
      marginTop: "2px",
      fontFamily: "var(--font-mono)"
    }
  }, k.prefix)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "12px",
      color: "var(--muted-foreground)",
      textAlign: "right"
    }
  }, /*#__PURE__*/React.createElement("div", null, "Created ", k.created), /*#__PURE__*/React.createElement("div", null, "Last used ", k.lastUsed)), /*#__PURE__*/React.createElement("button", {
    onClick: () => handleCopy(i),
    style: {
      display: "flex",
      alignItems: "center",
      gap: "5px",
      padding: "6px 12px",
      fontSize: "12px",
      fontWeight: 500,
      background: copied === i ? "var(--color-success-100)" : "var(--muted)",
      color: copied === i ? "var(--color-success-700)" : "var(--foreground)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-sm)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)",
      transition: "background 200ms"
    }
  }, copied === i ? "✓ Copied" : "Copy"), /*#__PURE__*/React.createElement("button", {
    style: {
      padding: "6px 12px",
      fontSize: "12px",
      fontWeight: 500,
      background: "transparent",
      color: "var(--destructive)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-sm)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, "Revoke")))));
}
function CanvasTab() {
  const [connected, setConnected] = React.useState(false);
  const [url, setUrl] = React.useState("https://canvas.ubc.ca");
  const [token, setToken] = React.useState("");
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "28px 24px",
      maxWidth: "720px",
      display: "flex",
      flexDirection: "column",
      gap: "24px"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: "18px",
      fontWeight: 600,
      color: "var(--foreground)",
      margin: "0 0 6px"
    }
  }, "Canvas Integration"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "14px",
      color: "var(--muted-foreground)",
      margin: 0,
      lineHeight: 1.5
    }
  }, "Connect your Canvas LMS account to sync course rosters, assignments, and student enrollments.")), /*#__PURE__*/React.createElement("div", {
    style: {
      background: connected ? "var(--color-success-100)" : "var(--muted)",
      border: `1px solid ${connected ? "var(--color-success-200)" : "var(--border)"}`,
      borderRadius: "var(--radius-lg)",
      padding: "16px 20px",
      display: "flex",
      alignItems: "center",
      gap: "12px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "36px",
      height: "36px",
      borderRadius: "8px",
      flexShrink: 0,
      background: connected ? "var(--color-success-500)" : "var(--muted-foreground)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "white",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, connected ? /*#__PURE__*/React.createElement("path", {
    d: "M20 6L9 17l-5-5"
  }) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 8v4M12 16h.01"
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "14px",
      fontWeight: 600,
      color: connected ? "var(--color-success-700)" : "var(--foreground)"
    }
  }, connected ? "Canvas connected" : "Canvas not connected"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "12px",
      color: connected ? "var(--color-success-600)" : "var(--muted-foreground)",
      marginTop: "2px"
    }
  }, connected ? `Connected to ${url}` : "Add your Canvas API key to enable sync")), connected && /*#__PURE__*/React.createElement("button", {
    onClick: () => setConnected(false),
    style: {
      padding: "6px 13px",
      fontSize: "13px",
      fontWeight: 500,
      background: "transparent",
      color: "var(--destructive)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-base)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, "Disconnect")), !connected && /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      padding: "20px 24px",
      display: "flex",
      flexDirection: "column",
      gap: "16px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "5px"
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: "13px",
      fontWeight: 500,
      color: "var(--foreground)"
    }
  }, "Canvas URL"), /*#__PURE__*/React.createElement("input", {
    value: url,
    onChange: e => setUrl(e.target.value),
    placeholder: "https://canvas.institution.edu",
    style: {
      padding: "8px 12px",
      fontSize: "13px",
      fontFamily: "var(--font-sans)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-base)",
      background: "var(--input)",
      color: "var(--foreground)",
      outline: "none"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "5px"
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: "13px",
      fontWeight: 500,
      color: "var(--foreground)"
    }
  }, "API Token"), /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: token,
    onChange: e => setToken(e.target.value),
    placeholder: "Paste your Canvas API token\u2026",
    style: {
      padding: "8px 12px",
      fontSize: "13px",
      fontFamily: "var(--font-sans)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-base)",
      background: "var(--input)",
      color: "var(--foreground)",
      outline: "none"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "12px",
      color: "var(--muted-foreground)"
    }
  }, "Generate from Canvas \u2192 Account \u2192 Settings \u2192 New Access Token")), /*#__PURE__*/React.createElement("button", {
    onClick: () => token && setConnected(true),
    style: {
      alignSelf: "flex-start",
      padding: "8px 18px",
      fontSize: "13px",
      fontWeight: 500,
      background: token ? "var(--primary)" : "var(--muted)",
      color: token ? "var(--primary-foreground)" : "var(--muted-foreground)",
      border: "none",
      borderRadius: "var(--radius-base)",
      cursor: token ? "pointer" : "not-allowed",
      fontFamily: "var(--font-sans)",
      transition: "background 150ms"
    }
  }, "Connect Canvas")));
}
function Settings() {
  const [tab, setTab] = React.useState("API Keys");
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      fontFamily: "var(--font-sans)",
      background: "var(--background)"
    }
  }, /*#__PURE__*/React.createElement(SettingsSiteHeader, null), /*#__PURE__*/React.createElement(SettingsTabBar, {
    active: tab,
    onSelect: setTab
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: "auto"
    }
  }, tab === "API Keys" && /*#__PURE__*/React.createElement(ApiKeysTab, null), tab === "Canvas" && /*#__PURE__*/React.createElement(CanvasTab, null)));
}
window.EduAIKit = window.EduAIKit || {};
window.EduAIKit.Settings = Settings;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/core/Settings.jsx", error: String((e && e.message) || e) }); }

// ui_kits/core/Sidebar.jsx
try { (() => {
/* Sidebar.jsx — matches app-sidebar.tsx + nav-user.tsx exactly */

const _SB = {
  bg: "oklch(0.192 0.055 259)",
  border: "oklch(0.248 0.048 259)",
  active: "oklch(0.248 0.055 259)",
  hover: "oklch(0.218 0.050 259)",
  text: "rgba(255,255,255,0.82)",
  muted: "rgba(255,255,255,0.46)",
  gold: "#FFD100"
};
const _SB_ICONS = {
  dashboard: ["M3 3h7v7H3z", "M14 3h7v7h-7z", "M3 14h7v7H3z", "M14 14h7v7h-7z"],
  books: ["M4 19V7.5a3.5 3.5 0 0 1 7 0V19", "M11 7.5a3.5 3.5 0 0 1 7 0V19", "M4 19h16"],
  brain: ["M9.5 2a2.5 2.5 0 1 1 5 0", "M4 9.5a2.5 2.5 0 1 1 5 0", "M15 9.5a2.5 2.5 0 1 1 5 0", "M12 4.5v5", "M6.5 12l3.5-2.5", "M17.5 12l-3.5-2.5", "M6.5 12a5.5 5.5 0 0 0 11 0"],
  users: ["M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M23 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  robot: ["M12 8V4", "M8 4h8", "M7 8h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z", "M9 13h.01", "M15 13h.01"],
  camera: ["M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z", "M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  report: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M16 13H8", "M16 17H8", "M10 9H8"],
  settings: ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a2 2 0 0 1-4 0"],
  help: ["M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10z", "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01"],
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"],
  dots: ["M12 5h.01", "M12 12h.01", "M12 19h.01"],
  account: ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  bell: ["M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9", "M13.73 21a2 2 0 0 1-3.46 0"]
};
const _ROLE_BADGES = {
  ADMIN: {
    label: "Admin",
    bg: "oklch(0.63 0.22 25)"
  },
  PROFESSOR: {
    label: "Prof",
    bg: "oklch(0.56 0.20 255)"
  },
  TA: {
    label: "TA",
    bg: "oklch(0.61 0.19 145)"
  },
  STUDENT: {
    label: "Student",
    bg: "oklch(0.55 0 0)"
  }
};

/* Nav structure matches app-sidebar.tsx exactly */
const _NAV_MAIN = [{
  id: "dashboard",
  label: "Dashboard",
  icon: "dashboard"
}, {
  id: "courses",
  label: "Courses",
  icon: "books"
}, {
  id: "admin-ai",
  label: "AI Management",
  icon: "brain",
  adminOnly: true
}, {
  id: "admin-users",
  label: "User Management",
  icon: "users",
  adminOnly: true
}, {
  id: "chatbot",
  label: "Chatbot",
  icon: "robot"
}, {
  id: "analytics",
  label: "Analytics",
  icon: "camera",
  stub: true
}, {
  id: "reports",
  label: "Reports",
  icon: "report",
  stub: true
}];
const _NAV_SEC = [{
  id: "settings",
  label: "Settings",
  icon: "settings"
}, {
  id: "help",
  label: "Get Help",
  icon: "help",
  stub: true
}];
function SBIcon({
  name,
  size = 16,
  color
}) {
  const d = _SB_ICONS[name];
  if (!d) return null;
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color || "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, (Array.isArray(d) ? d : [d]).map((p, i) => /*#__PURE__*/React.createElement("path", {
    key: i,
    d: p
  })));
}
function Sidebar({
  currentScreen,
  onNavigate,
  user
}) {
  const [showMenu, setShowMenu] = React.useState(false);
  const [hov, setHov] = React.useState(null);
  const role = user?.role || "STUDENT";
  const badge = _ROLE_BADGES[role] || _ROLE_BADGES.STUDENT;
  const initials = (user?.name || "U").split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();

  /* map chatbot ↔ chat so the nav highlights correctly */
  const activeId = currentScreen === "chatbot" ? "chatbot" : currentScreen === "chat" ? "chatbot" : currentScreen;
  const visible = _NAV_MAIN.filter(i => !i.adminOnly || role === "ADMIN");
  const Item = ({
    item
  }) => {
    const on = activeId === item.id;
    const hovd = hov === item.id;
    return /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        if (!item.stub) onNavigate(item.id);
      },
      onMouseEnter: () => setHov(item.id),
      onMouseLeave: () => setHov(null),
      style: {
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        width: "100%",
        padding: "9px 14px 9px 16px",
        borderRadius: "7px",
        background: on ? _SB.active : hovd && !item.stub ? _SB.hover : "transparent",
        border: "none",
        cursor: item.stub ? "default" : "pointer",
        color: item.stub ? _SB.muted : on ? "#fff" : _SB.text,
        fontFamily: "var(--font-sans)",
        fontSize: "13.5px",
        fontWeight: on ? 500 : 400,
        transition: "background 120ms"
      }
    }, on && /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        left: 0,
        top: "8px",
        bottom: "8px",
        width: "3px",
        borderRadius: "0 2px 2px 0",
        background: _SB.gold
      }
    }), /*#__PURE__*/React.createElement(SBIcon, {
      name: item.icon,
      size: 16
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1
      }
    }, item.label), item.stub && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: "10px",
        opacity: .5
      }
    }, "Soon"));
  };
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      width: "240px",
      minWidth: "240px",
      height: "100vh",
      background: _SB.bg,
      display: "flex",
      flexDirection: "column",
      borderRight: `1px solid ${_SB.border}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: "56px",
      display: "flex",
      alignItems: "center",
      padding: "0 16px",
      gap: "9px",
      borderBottom: `1px solid ${_SB.border}`,
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "28px",
      height: "28px",
      borderRadius: "7px",
      background: "oklch(0.42 0.14 232)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "15",
    height: "15",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "white",
    strokeWidth: "1.75",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "9"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 3a9 9 0 0 1 0 18"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M3 12h18"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 3c2 2 3.5 5.5 3.5 9s-1.5 7-3.5 9"
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "15px",
      fontWeight: 700,
      color: "#fff",
      letterSpacing: "-0.01em"
    }
  }, "EduAI")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      padding: "10px 8px",
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      overflowY: "auto"
    }
  }, visible.map(i => /*#__PURE__*/React.createElement(Item, {
    key: i.id,
    item: i
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      height: "1px",
      background: _SB.border,
      margin: "6px 0"
    }
  }), _NAV_SEC.map(i => /*#__PURE__*/React.createElement(Item, {
    key: i.id,
    item: i
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      borderTop: `1px solid ${_SB.border}`,
      padding: "8px"
    }
  }, showMenu && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      bottom: "calc(100% + 4px)",
      left: "8px",
      right: "8px",
      background: "oklch(0.240 0.048 259)",
      border: `1px solid ${_SB.border}`,
      borderRadius: "10px",
      overflow: "hidden",
      zIndex: 100,
      boxShadow: "0 -8px 24px rgba(0,0,0,0.35)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "12px 14px",
      borderBottom: `1px solid ${_SB.border}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "13px",
      fontWeight: 600,
      color: "#fff"
    }
  }, user?.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "11px",
      color: _SB.muted
    }
  }, user?.email)), [{
    l: "Account",
    icon: "account"
  }, {
    l: "Notifications",
    icon: "bell"
  }].map(m => /*#__PURE__*/React.createElement("button", {
    key: m.l,
    style: {
      display: "flex",
      alignItems: "center",
      gap: "9px",
      width: "100%",
      padding: "9px 14px",
      background: "transparent",
      border: "none",
      color: _SB.text,
      fontFamily: "var(--font-sans)",
      fontSize: "13px",
      cursor: "pointer"
    },
    onMouseEnter: e => e.currentTarget.style.background = _SB.hover,
    onMouseLeave: e => e.currentTarget.style.background = "transparent"
  }, /*#__PURE__*/React.createElement(SBIcon, {
    name: m.icon,
    size: 15
  }), m.l)), /*#__PURE__*/React.createElement("div", {
    style: {
      height: "1px",
      background: _SB.border
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setShowMenu(false);
      onNavigate("logout");
    },
    style: {
      display: "flex",
      alignItems: "center",
      gap: "9px",
      width: "100%",
      padding: "9px 14px",
      background: "transparent",
      border: "none",
      color: "oklch(0.72 0.19 25)",
      fontFamily: "var(--font-sans)",
      fontSize: "13px",
      cursor: "pointer"
    },
    onMouseEnter: e => e.currentTarget.style.background = "oklch(0.72 0.19 25 / 0.12)",
    onMouseLeave: e => e.currentTarget.style.background = "transparent"
  }, /*#__PURE__*/React.createElement(SBIcon, {
    name: "logout",
    size: 15,
    color: "oklch(0.72 0.19 25)"
  }), "Log out")), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowMenu(v => !v),
    style: {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      width: "100%",
      padding: "7px 10px",
      borderRadius: "8px",
      background: showMenu ? _SB.active : "transparent",
      border: "none",
      cursor: "pointer",
      transition: "background 120ms"
    },
    onMouseEnter: e => {
      if (!showMenu) e.currentTarget.style.background = _SB.hover;
    },
    onMouseLeave: e => {
      if (!showMenu) e.currentTarget.style.background = "transparent";
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "32px",
      height: "32px",
      borderRadius: "8px",
      flexShrink: 0,
      background: "oklch(0.42 0.14 232)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#fff",
      fontWeight: 700,
      fontSize: "12px"
    }
  }, initials), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      textAlign: "left",
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "5px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "13px",
      fontWeight: 500,
      color: "#fff",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, user?.name || "User"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "10px",
      fontWeight: 700,
      padding: "1px 5px",
      borderRadius: "999px",
      background: badge.bg,
      color: "#fff",
      flexShrink: 0
    }
  }, badge.label)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "11px",
      color: _SB.muted,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, user?.email)), /*#__PURE__*/React.createElement(SBIcon, {
    name: "dots",
    size: 14,
    color: _SB.muted
  }))));
}
window.EduAIKit = window.EduAIKit || {};
window.EduAIKit.Sidebar = Sidebar;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/core/Sidebar.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.CardHeader = __ds_scope.CardHeader;

__ds_ns.CardTitle = __ds_scope.CardTitle;

__ds_ns.CardDescription = __ds_scope.CardDescription;

__ds_ns.CardContent = __ds_scope.CardContent;

__ds_ns.CardFooter = __ds_scope.CardFooter;

__ds_ns.StatCard = __ds_scope.StatCard;

})();
