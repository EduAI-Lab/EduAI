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
  cancelLabel?: string
  variant?: "default" | "destructive"
  /**
   * Set while the confirmed action is in flight: both buttons disable and the
   * confirm label gains an ellipsis, so the action cannot be submitted twice.
   */
  isLoading?: boolean
  /**
   * Whether confirming dismisses the dialog immediately (the default). Pass `false`
   * when the caller runs async work and closes the dialog itself once it settles —
   * otherwise the dialog disappears before `isLoading` can ever be seen.
   */
  closeOnConfirm?: boolean
  onConfirm: () => void
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "destructive",
  isLoading = false,
  closeOnConfirm = true,
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
          <AlertDialogCancel disabled={isLoading}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            className={
              displayVariant === "destructive"
                ? buttonVariants({ variant: "destructive" })
                : undefined
            }
            disabled={isLoading}
            onClick={(event) => {
              // Radix dismisses on action click; hold the dialog open when the
              // caller owns closing so its in-flight state stays visible.
              if (!closeOnConfirm) event.preventDefault()
              onConfirm()
            }}
          >
            {isLoading ? `${displayConfirmLabel}…` : displayConfirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
