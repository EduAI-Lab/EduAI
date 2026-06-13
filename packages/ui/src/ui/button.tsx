import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../utils"

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium font-sans",
    "border cursor-pointer shrink-0",
    "transition-[background,opacity,filter,box-shadow] duration-150 ease-in-out",
    "outline-none focus-visible:border-ring focus-visible:shadow-[var(--shadow-focus)]",
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
    "disabled:cursor-not-allowed disabled:opacity-50",
  ].join(" "),
  {
    variants: {
      variant: {
        // "default" kept as alias for primary (shadcn backward compat)
        default:
          "bg-primary text-primary-foreground border-primary hover:brightness-90 dark:hover:brightness-125 active:brightness-75",
        primary:
          "bg-primary text-primary-foreground border-primary hover:brightness-90 dark:hover:brightness-125 active:brightness-75",
        secondary:
          "bg-secondary text-secondary-foreground border-secondary hover:brightness-90 dark:hover:brightness-125 active:brightness-75",
        outline:
          "bg-transparent text-primary dark:text-primary-foreground border-border hover:bg-muted/50",
        ghost:
          "bg-transparent text-foreground border-transparent hover:bg-muted/60",
        destructive:
          "bg-destructive text-destructive-foreground border-destructive hover:brightness-90 active:brightness-75",
        link: "bg-transparent text-primary border-transparent underline-offset-4 hover:underline",
        gold: "bg-[var(--color-gold-100)] text-[var(--color-gold-700)] border-[var(--color-gold-400)] hover:brightness-90",
      },
      size: {
        default:
          "text-sm px-4 min-h-[38px] py-2 rounded-[var(--radius-base)] has-[>svg]:px-3",
        sm: "text-[13px] px-3 min-h-8 py-1 rounded-[var(--radius-base)] has-[>svg]:px-2.5",
        lg: "text-[15px] px-5 min-h-11 py-3 rounded-[var(--radius-base)] has-[>svg]:px-4",
        icon: "text-sm size-[38px] rounded-[var(--radius-base)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
