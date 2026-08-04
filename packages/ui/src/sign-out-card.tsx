import * as React from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"

export interface SignOutCardProps {
  /**
   * The sign-out control itself. Apps differ in how they log out — Core posts to a
   * React Router action, the extensions call a handler — so the trigger is injected
   * rather than owned here.
   */
  action: React.ReactNode
  /** Defaults to the platform-wide wording; override only with a good reason. */
  title?: string
  description?: string
  className?: string
}

/**
 * The sign-out card that closes every settings page.
 *
 * Previously hand-copied in Core and ai-tutor (and missing entirely from QM), with the
 * title and description already drifted three ways.
 */
export function SignOutCard({
  action,
  title = "Sign out",
  description = "Sign out of EduAI on this browser.",
  className,
}: SignOutCardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{action}</CardContent>
    </Card>
  )
}
