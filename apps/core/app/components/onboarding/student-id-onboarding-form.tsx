import { Form } from "react-router";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
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
    <div className={cn("flex flex-col gap-6", className)}>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold">Link your student number</h1>
        <p className="text-muted-foreground text-sm text-balance">
          Enter your student number so we can match you to your courses.
        </p>
      </div>

      {formError && (
        <p className="text-sm text-destructive text-center" role="alert">
          {formError}
        </p>
      )}

      <Form method="post" className="grid gap-4">
        <div className="grid gap-3">
          <Label htmlFor="studentNumber">Student number</Label>
          <Input
            id="studentNumber"
            name="studentNumber"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 12345678"
            required
            disabled={isLoading}
            className={fieldError ? "border-destructive" : undefined}
          />
          {fieldError && <p className="text-sm text-destructive">{fieldError}</p>}
          <p className="text-xs text-muted-foreground">
            This must match your student ID.
          </p>
        </div>

        <Button type="submit" name="intent" value="link" disabled={isLoading}>
          {isLoading ? "Linking…" : "Continue"}
        </Button>
      </Form>

      <Form method="post">
        <Button
          type="submit"
          name="intent"
          value="skip"
          variant="ghost"
          className="w-full"
          disabled={isLoading}
        >
          Skip for now
        </Button>
      </Form>

      <p className="text-center text-xs text-muted-foreground">
        Ask your instructor to sync Canvas first if linking fails. You can try again later.
      </p>
    </div>
  );
}
