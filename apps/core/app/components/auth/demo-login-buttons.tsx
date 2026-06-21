/**
 * Demo account quick-login buttons for QA / dev testing.
 *
 * Credentials come from apps/core/prisma/seed.ts. To use these buttons,
 * the local database must be seeded first:
 *
 *   cd apps/core && npx prisma db seed
 *
 * All demo accounts share the password defined as SEED_PASSWORD in seed.ts.
 * Do NOT use these credentials in production — they are development fixtures only.
 */

import { RoleBadge } from "@eduai/ui"
import { useRef } from "react"

// ---------------------------------------------------------------------------
// Seed credentials — kept in sync with apps/core/prisma/seed.ts
// ---------------------------------------------------------------------------

const DEMO_PASSWORD = "EduAI2026!"

const DEMO_ACCOUNTS = [
  {
    role: "ADMIN",
    email: "admin@eduai.local",
  },
  {
    role: "UNIT_ADMIN",
    email: "unitadmin.cosc@eduai.local",
  },
  {
    role: "INSTRUCTOR",
    email: "instructor.cs@eduai.local",
  },
  {
    role: "TA",
    email: "ta.cs@eduai.local",
  },
  {
    role: "STUDENT",
    email: "student1@eduai.local",
  },
] as const

// ---------------------------------------------------------------------------

interface DemoLoginButtonsProps {
  /** The hidden <input name="redirectTo"> value in the outer form. Needed so
   *  the submit targets the same redirect as a normal login. */
  redirectTo: string
  /** Called when a demo button is clicked, before the form submits.
   *  Use this to set isLoading state in the parent if needed. */
  onSubmit?: () => void
}

/**
 * Renders a "Demo accounts (testing only)" section with one quick-login
 * button per role. Each button fills a hidden form and submits it, so the
 * normal server-side login action handles auth — no client-side credentials
 * are exposed beyond what the server already processes.
 */
export function DemoLoginButtons({ redirectTo, onSubmit }: DemoLoginButtonsProps) {
  const formRefs = useRef<Map<string, HTMLFormElement>>(new Map())

  function handleClick(email: string) {
    const form = formRefs.current.get(email)
    if (!form) return
    onSubmit?.()
    form.requestSubmit()
  }

  return (
    <div
      style={{
        marginTop: "24px",
        paddingTop: "20px",
        borderTop: "1px solid var(--border)",
      }}
    >
      <p
        style={{
          fontSize: "10px",
          fontWeight: 600,
          color: "var(--muted-foreground)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          marginBottom: "10px",
        }}
      >
        Demo accounts (testing only)
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "6px",
        }}
      >
        {DEMO_ACCOUNTS.map(({ role, email }) => (
          <div key={role}>
            {/* Hidden form per demo account — submit goes through the standard
                login action so server-side validation and session handling run
                as normal. */}
            <form
              ref={(el) => {
                if (el) formRefs.current.set(email, el)
              }}
              method="post"
              style={{ display: "none" }}
            >
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <input type="hidden" name="email" value={email} />
              <input type="hidden" name="password" value={DEMO_PASSWORD} />
            </form>

            <button
              type="button"
              onClick={() => handleClick(email)}
              title={email}
              style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: "3px",
                padding: "7px 9px",
                background: "var(--muted)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                fontFamily: "var(--font-sans)",
                transition: "border-color 120ms, background 120ms",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--secondary)"
                e.currentTarget.style.background = "var(--accent)"
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)"
                e.currentTarget.style.background = "var(--muted)"
              }}
            >
              {/* Role badge */}
              <RoleBadge role={role} />

              {/* Email hint */}
              <span
                style={{
                  fontSize: "9px",
                  color: "var(--muted-foreground)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "100%",
                }}
              >
                {email}
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
