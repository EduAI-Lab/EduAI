import { Form } from "react-router";

import { Button } from "@eduai/ui";
import { Input } from "@eduai/ui";
import { Label } from "@eduai/ui";
import { cn } from "~/lib/utils";

export interface StudentIdOnboardingFormProps {
  formError?: string;
  fieldError?: string;
  isLoading?: boolean;
  className?: string;
}

export function StudentIdOnboardingForm({
  formError,
  fieldError,
  isLoading = false,
  className,
}: StudentIdOnboardingFormProps) {
  return (
    <div className={cn("bg-card border rounded-[var(--radius-xl)] p-10 shadow-lg", className)} style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.08)" }}>
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-7">
        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0" style={{ background: "var(--primary)" }}>1</div>
        <div className="flex-1 h-0.5 bg-border" />
        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-muted-foreground flex-shrink-0 bg-muted">2</div>
      </div>

      <h1 className="text-[22px] font-bold text-foreground mb-2">Link your UBC student number</h1>
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
        We use your student number to match your account with Canvas enrolment data so your courses sync automatically.
      </p>

      {formError && (
        <p className="text-sm text-destructive text-center mb-4" role="alert">{formError}</p>
      )}

      <Form method="post" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="studentNumber">UBC Student Number</Label>
          <Input
            id="studentNumber"
            name="studentNumber"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 12345678"
            required
            disabled={isLoading}
            className={cn("font-mono text-lg tracking-wider", fieldError ? "border-destructive" : undefined)}
          />
          {fieldError && <p className="text-sm text-destructive">{fieldError}</p>}
          <p className="text-xs text-muted-foreground">Your 8-digit student number, found on your UBC Card or SSC.</p>
        </div>

        {/* Info box */}
        <div className="rounded-lg p-3 flex gap-2.5" style={{ background: "oklch(0.192 0.055 259 / 0.05)", border: "1px solid oklch(0.192 0.055 259 / 0.12)" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0 mt-0.5" style={{ stroke: "var(--primary)" }}>
            <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
          </svg>
          <span className="text-xs leading-relaxed" style={{ color: "var(--primary)" }}>
            Your student number is only used to match Canvas enrolments. Stored securely, never shared.
          </span>
        </div>

        <Button type="submit" name="intent" value="link" disabled={isLoading} className="min-h-[44px]">
          {isLoading ? "Verifying…" : "Link student number"}
        </Button>
      </Form>

      <Form method="post" className="mt-2">
        <Button type="submit" name="intent" value="skip" variant="ghost" className="w-full text-muted-foreground" disabled={isLoading}>
          Skip for now — I'll do this later
        </Button>
      </Form>
    </div>
  );
}
