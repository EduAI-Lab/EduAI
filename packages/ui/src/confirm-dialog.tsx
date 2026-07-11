import { useRef } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog"
import { buttonVariants } from "./ui/button"

export type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  variant?: "default" | "destructive"
  onConfirm: () => void
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  variant = "destructive",
  onConfirm,
}: ConfirmDialogProps) {
  const lastOpenContentRef = useRef({
    title,
    description,
    confirmLabel,
    variant,
  })

  if (open) {
    lastOpenContentRef.current = { title, description, confirmLabel, variant }
  }

  const {
    title: displayTitle,
    description: displayDescription,
    confirmLabel: displayConfirmLabel,
    variant: displayVariant,
  } = open ? { title, description, confirmLabel, variant } : lastOpenContentRef.current

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{displayTitle}</AlertDialogTitle>
          <AlertDialogDescription>{displayDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={
              displayVariant === "destructive"
                ? buttonVariants({ variant: "destructive" })
                : undefined
            }
            onClick={onConfirm}
          >
            {displayConfirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
