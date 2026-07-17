import * as React from "react";

/**
 * EduAI Avatar — user avatar with image and initials fallback.
 */
export function Avatar({
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
    xs:      { width: "24px", height: "24px", fontSize: "9px" },
    sm:      { width: "32px", height: "32px", fontSize: "12px" },
    default: { width: "40px", height: "40px", fontSize: "14px" },
    lg:      { width: "48px", height: "48px", fontSize: "17px" },
    xl:      { width: "64px", height: "64px", fontSize: "22px" },
  };

  const radius = shape === "circle" ? "50%" : shape === "rounded" ? "var(--radius-base)" : "var(--radius-sm)";

  const getInitials = (n) => {
    if (!n) return "?";
    return n.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2);
  };

  const getHue = (n) => {
    if (!n) return 259;
    let h = 0;
    for (let i = 0; i < n.length; i++) h = n.charCodeAt(i) + ((h << 5) - h);
    return Math.abs(h) % 360;
  };

  const hue = getHue(name);
  const avatarBg = `oklch(0.42 0.14 ${hue})`;

  const containerStyle = {
    ...sizes[size] || sizes.default,
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
    ...style,
  };

  const showFallback = !src || imgError;

  return (
    <div style={containerStyle} {...props}>
      {!showFallback ? (
        <img
          src={src}
          alt={alt || name}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={() => setImgError(true)}
        />
      ) : (
        <span style={{ fontSize: sizes[size]?.fontSize || "14px", lineHeight: 1 }}>
          {getInitials(name)}
        </span>
      )}
    </div>
  );
}
