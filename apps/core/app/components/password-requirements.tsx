import { Check, Circle } from "lucide-react";

import { getPasswordRequirementStatus } from "~/lib/auth/password-policy";
import { cn } from "~/lib/utils";

type RequirementProps = {
  met: boolean;
  children: React.ReactNode;
};

function Requirement({ met, children }: RequirementProps) {
  const Icon = met ? Check : Circle;

  return (
    <li
      className={cn(
        "flex items-center gap-1.5",
        met ? "text-green-700 dark:text-green-400" : "text-muted-foreground",
      )}
      data-state={met ? "met" : "unmet"}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

export function PasswordRequirements({
  password,
  id = "password-requirements",
}: {
  password: string;
  id?: string;
}) {
  const status = getPasswordRequirementStatus(password);
  const valid = status.passphrase || status.complex;

  if (valid) {
    return (
      <p
        id={id}
        className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400"
        aria-live="polite"
      >
        <Check className="size-3.5 shrink-0" aria-hidden="true" />
        Password meets requirements.
      </p>
    );
  }

  return (
    <div id={id} className="space-y-1.5 text-xs" aria-live="polite">
      <p className="text-muted-foreground">Choose either option:</p>
      <ul className="space-y-1">
        <Requirement met={status.passphrase}>16 or more characters</Requirement>
      </ul>
      <p className="text-muted-foreground">or all of:</p>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        <Requirement met={status.minimumLength}>8 or more characters</Requirement>
        <Requirement met={status.lowercase}>One lowercase letter</Requirement>
        <Requirement met={status.uppercase}>One uppercase letter</Requirement>
        <Requirement met={status.number}>One number</Requirement>
        <Requirement met={status.symbol}>One symbol</Requirement>
      </ul>
    </div>
  );
}
