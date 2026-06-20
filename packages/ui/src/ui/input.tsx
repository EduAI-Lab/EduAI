import * as React from "react"

import { cn } from "../utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex min-h-[38px] w-full min-w-0 rounded-[var(--radius-md)] border border-border bg-input px-3 py-2 text-sm text-foreground font-sans",
        "placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground",
        "transition-[border-color,box-shadow] duration-150 ease-in-out outline-none",
        "focus-visible:border-ring focus-visible:shadow-[var(--shadow-focus)]",
        "aria-invalid:border-destructive aria-invalid:shadow-[var(--shadow-focus-error)]",
        "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        "file:text-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className
      )}
      {...props}
    />
  )
}

export { Input }
