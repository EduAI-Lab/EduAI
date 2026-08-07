import { cn } from "~/lib/utils"
import { Button } from "@eduai/ui"
import { Input } from "@eduai/ui"
import { Label } from "@eduai/ui"
import type { SignInInput } from "~/lib/auth"

export interface LoginFormProps extends React.ComponentProps<"div"> {
  fieldErrors?: Partial<Record<keyof SignInInput, string>>;
  isLoading?: boolean;
  /** §6b: hide the "Sign up" link when public registration is disabled. */
  allowRegistration?: boolean;
}

export function LoginForm({
  className,
  fieldErrors,
  isLoading = false,
  allowRegistration = true,
  ...props
}: LoginFormProps) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold">Welcome back</h1>
        <p className="text-muted-foreground text-sm text-balance">
          Sign in to your UBC EduAI account.
        </p>
      </div>
      <div className="grid gap-6">
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
          {fieldErrors?.email && (
            <p className="text-sm text-destructive">{fieldErrors.email}</p>
          )}
        </div>
        <div className="grid gap-3">
          <div className="flex items-center">
            <Label htmlFor="password">Password</Label>
            <a
              href="#"
              className="ml-auto text-sm underline-offset-4 hover:underline"
            >
              Forgot your password?
            </a>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            required
            disabled={isLoading}
            className={fieldErrors?.password ? "border-destructive" : ""}
          />
          {fieldErrors?.password && (
            <p className="text-sm text-destructive">{fieldErrors.password}</p>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? "Signing in..." : "Sign in"}
        </Button>
      </div>
      {allowRegistration && (
        <div className="text-center text-sm">
          Don&apos;t have an account?{" "}
          <a href="/auth/register" className="underline underline-offset-4">
            Sign up
          </a>
        </div>
      )}
    </div>
  )
}
