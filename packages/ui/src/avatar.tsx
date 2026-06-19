import { useState } from "react"
import type { CSSProperties } from "react"
import { getInitials } from "./utils"

function nameToHue(name: string): number {
  const hash = [...name].reduce((h, c) => c.charCodeAt(0) + ((h << 5) - h), 0)
  return Math.abs(hash) % 360
}

export interface AvatarProps {
  name: string
  src?: string | null
  size?: number
  radius?: number
  className?: string
  style?: CSSProperties
}

export function Avatar({ name, src, size = 32, radius = 8, className, style }: AvatarProps) {
  const [imgError, setImgError] = useState(false)
  const hue = nameToHue(name)
  const initials = getInitials(name)
  const showImg = Boolean(src) && !imgError

  if (showImg) {
    return (
      <img
        src={src!}
        alt={name}
        width={size}
        height={size}
        className={className}
        style={{ borderRadius: radius, objectFit: "cover", flexShrink: 0, display: "block", ...style }}
        onError={() => setImgError(true)}
      />
    )
  }

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        flexShrink: 0,
        background: `oklch(0.42 0.14 ${hue})`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontWeight: 600,
        fontSize: Math.round(size * 0.34),
        userSelect: "none",
        ...style,
      }}
    >
      {initials}
    </div>
  )
}
