import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../utils"

const badgeVariants = cva(
  [
    "inline-flex items-center gap-1 font-semibold rounded-full border whitespace-nowrap leading-none",
    "transition-[color,box-shadow] duration-150",
    "[&>svg]:size-3 [&>svg]:pointer-events-none",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border-transparent",
        secondary:
          "bg-secondary text-secondary-foreground border-transparent",
        outline:
          "bg-transparent text-foreground border-border",
        muted:
          "bg-muted text-muted-foreground border-transparent",
        success:
          "bg-[var(--color-success-100)] text-[var(--color-success-700)] border-[var(--color-success-500)]",
        warning:
          "bg-[var(--color-warning-100)] text-[var(--color-warning-700)] border-[var(--color-warning-500)]",
        destructive:
          "bg-[var(--color-error-100)] text-[var(--color-error-700)] border-[var(--color-error-500)]",
        gold:
          "bg-[var(--color-gold-100)] text-[var(--color-gold-700)] border-[var(--color-gold-400)]",
      },
      size: {
        sm: "text-[10px] px-1.5 py-0.5",
        default: "text-[11px] px-2 py-[3px]",
        lg: "text-[13px] px-2.5 py-1",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Badge({
  className,
  variant,
  size,
  asChild = false,
  dot = false,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean
    dot?: boolean
  }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    >
      {dot && (
        <span className="size-1.5 rounded-full bg-current opacity-70 shrink-0" />
      )}
      {children}
    </Comp>
  )
}

export { Badge, badgeVariants }
