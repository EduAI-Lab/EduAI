import { useState } from "react"

import { cn } from "~/lib/utils"
import { Button } from "@eduai/ui"
import { Input } from "@eduai/ui"
import { Label } from "@eduai/ui"
import type { SignUpInput } from "~/lib/auth"
import { PasswordRequirements } from "~/components/password-requirements"

export interface RegisterFormProps extends React.ComponentProps<"div"> {
  fieldErrors?: Partial<Record<keyof SignUpInput, string>>;
  isLoading?: boolean;
}

export function RegisterForm({
  className,
  fieldErrors,
  isLoading = false,
  ...props
}: RegisterFormProps) {
  const [password, setPassword] = useState("");

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
          {fieldErrors?.name && (
            <p className="text-sm text-destructive">{fieldErrors.name}</p>
          )}
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
            className={fieldErrors?.email ? "border-destructive" : ""}
          />
          {fieldErrors?.email ? (
            <p className="text-sm text-destructive">{fieldErrors.email}</p>
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
          <PasswordRequirements
            password={password}
            id="register-password-requirements"
          />
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
        <a href="/auth/login" className="underline underline-offset-4">
          Login
        </a>
      </div>
    </div>
  )
}
