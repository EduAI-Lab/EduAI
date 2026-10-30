import { useState } from "react";

import { cn } from "~/lib/utils";
import { Button } from "@eduai/ui";
import { Input } from "@eduai/ui";
import { Label } from "@eduai/ui";
import type { SignUpInput } from "~/lib/auth";
import { isUbcEmail, UBC_EMAIL_MESSAGE } from "~/lib/auth/ubc-email";
import { PasswordRequirements } from "~/components/password-requirements";

export interface RegisterFormProps extends React.ComponentProps<"div"> {
  fieldErrors?: Partial<Record<keyof SignUpInput, string>>;
  isLoading?: boolean;
  /** #1961: Login keeps a course join link. */
  loginHref?: string;
}

export function RegisterForm({
  className,
  fieldErrors,
  isLoading = false,
  loginHref = "/auth/login",
  ...props
}: RegisterFormProps) {
  const [password, setPassword] = useState("");
  // #1942: `type="email"` accepts any domain, so a non-UBC address used to
  // survive both password fields before the server said no. Checked on blur,
  // re-checked while correcting, and set as the field's validity so the
  // browser blocks submit too.
  const [emailError, setEmailError] = useState<string | null>(null);

  function checkUbcEmail(input: HTMLInputElement) {
    const message = input.value.trim() && !isUbcEmail(input.value) ? UBC_EMAIL_MESSAGE : null;
    input.setCustomValidity(message ?? "");
    setEmailError(message);
  }

  const shownEmailError = fieldErrors?.email ?? emailError;

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold">Create your account</h1>
        <p className="text-muted-foreground text-sm text-balance">
          Get started with AI-powered learning.
        </p>
      </div>
      <div className="grid gap-4">
        <div className="grid gap-3">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            type="text"
            placeholder="Your name"
            required
            disabled={isLoading}
            className={fieldErrors?.name ? "border-destructive" : ""}
          />
          {fieldErrors?.name && <p className="text-sm text-destructive">{fieldErrors.name}</p>}
        </div>
        <div className="grid gap-3">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@ubc.ca"
            required
            disabled={isLoading}
            aria-invalid={shownEmailError ? true : undefined}
            onBlur={(event) => checkUbcEmail(event.currentTarget)}
            onChange={(event) => {
              if (emailError) checkUbcEmail(event.currentTarget);
            }}
            className={shownEmailError ? "border-destructive" : ""}
          />
          {shownEmailError ? (
            <p className="text-sm text-destructive">{shownEmailError}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Must be a UBC address (e.g. you@student.ubc.ca or you@ubc.ca).
            </p>
          )}
        </div>
        <div className="grid gap-3">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            disabled={isLoading}
            autoComplete="new-password"
            aria-describedby="register-password-requirements"
            onChange={(event) => setPassword(event.currentTarget.value)}
            className={fieldErrors?.password ? "border-destructive" : ""}
          />
          <PasswordRequirements password={password} id="register-password-requirements" />
          {fieldErrors?.password && (
            <p className="text-sm text-destructive" role="alert">
              {fieldErrors.password}
            </p>
          )}
        </div>
        <div className="grid gap-3">
          <Label htmlFor="confirm-password">Confirm Password</Label>
          <Input
            id="confirm-password"
            name="confirmPassword"
            type="password"
            required
            disabled={isLoading}
            autoComplete="new-password"
            className={fieldErrors?.confirmPassword ? "border-destructive" : ""}
          />
          {fieldErrors?.confirmPassword && (
            <p className="text-sm text-destructive">{fieldErrors.confirmPassword}</p>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? "Creating account..." : "Create account"}
        </Button>
      </div>
      <div className="text-center text-sm">
        Already have an account?{" "}
        <a href={loginHref} className="underline underline-offset-4">
          Login
        </a>
      </div>
    </div>
  );
}
