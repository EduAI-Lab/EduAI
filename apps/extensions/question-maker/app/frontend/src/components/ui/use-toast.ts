/**
 * Toast helpers backed by sonner — keeps the legacy useToast API for existing callers.
 */
import * as React from "react"
import { toast as sonnerToast, type ExternalToast } from "sonner"

type ToastInput = {
  title?: React.ReactNode
  description?: React.ReactNode
  variant?: "default" | "destructive"
  duration?: number
  action?: React.ReactNode
}

/** Legacy action slot — parsed by showToast, not rendered in the tree. */
export function ToastAction({
  children: _children,
  altText: _altText,
  onClick: _onClick,
}: {
  children: React.ReactNode
  altText?: string
  onClick?: () => void
}) {
  return null
}

function buildSonnerOptions({
  description,
  duration,
  action,
}: Pick<ToastInput, "description" | "duration" | "action">): ExternalToast {
  const options: ExternalToast = {}

  if (description != null) {
    options.description = String(description)
  }

  if (duration === Number.POSITIVE_INFINITY || duration === Infinity) {
    options.duration = Infinity
  } else if (duration != null) {
    options.duration = duration
  }

  if (React.isValidElement(action)) {
    const props = action.props as {
      onClick?: () => void
      children?: React.ReactNode
      altText?: string
    }
    if (props.onClick) {
      options.action = {
        label: String(props.children ?? props.altText ?? "Action"),
        onClick: props.onClick,
      }
    }
  }

  return options
}

function showToast({ title, description, variant, duration, action }: ToastInput) {
  const message =
    title != null ? String(title) : description != null ? String(description) : ""
  const options = buildSonnerOptions({ description: title != null ? description : undefined, duration, action })

  if (variant === "destructive") {
    const id = sonnerToast.error(message, options)
    return {
      id: String(id),
      dismiss: () => sonnerToast.dismiss(id),
      update: () => {},
    }
  }

  const id = sonnerToast(message, options)
  return {
    id: String(id),
    dismiss: () => sonnerToast.dismiss(id),
    update: () => {},
  }
}

function useToast() {
  return {
    toast: showToast,
    dismiss: (toastId?: string | number) => sonnerToast.dismiss(toastId),
    toasts: [],
  }
}

export { useToast, showToast as toast }
