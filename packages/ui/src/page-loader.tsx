export interface PageLoaderProps {
  className?: string
}

/**
 * Full-viewport loading state shown while an app resolves its initial auth/
 * session check on the client. Shared across EduAI Core, AI Tutor, and
 * Question Maker so the brief loading window looks identical everywhere.
 */
export function PageLoader({ className }: PageLoaderProps) {
  return (
    <div
      className={`min-h-dvh flex items-center justify-center bg-background${className ? ` ${className}` : ""}`}
    >
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  )
}
