import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router"
import { IconStack2 } from "@tabler/icons-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"

import { acceptInvitationSchema, type AcceptInvitationInput } from "~/lib/invitations/schemas"
import { acceptInvitation, getInvitationByToken } from "~/lib/invitations/service.server"
import { PasswordRequirements } from "~/components/password-requirements"
import { fireAndForget, logAuditAction } from "~/lib/logging.server"
import { getActorContext, getRequestContext } from "~/lib/request-context.server"
import { userNeedsStudentIdOnboarding } from "~/lib/canvas/onboarding.server"

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrator",
  UNIT_ADMIN: "Unit Administrator",
  INSTRUCTOR: "Instructor",
  STUDENT: "Student",
};

const ERROR_MESSAGES: Record<string, string> = {
  MISSING_TOKEN: "This invitation link is missing its token.",
  INVALID_TOKEN: "This invitation link is invalid.",
  INVITATION_USED: "This invitation has already been used.",
  INVITATION_REVOKED: "This invitation was cancelled. Ask an administrator to send a new one.",
  INVITATION_EXPIRED: "This invitation has expired. Ask an administrator to send a new one.",
  USER_EXISTS: "An account already exists for this email. Try logging in instead.",
  SIGNUP_FAILED: "We couldn't create your account. Please try again.",
};

function friendlyError(code: string): string {
  return ERROR_MESSAGES[code] ?? "Something went wrong with this invitation.";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return { ok: false as const, error: friendlyError("MISSING_TOKEN") };
  }

  const result = await getInvitationByToken(token);
  if (!result.ok) {
    return { ok: false as const, error: friendlyError(result.error) };
  }

  const { email, role, name } = result.invitation;
  return { ok: true as const, token, email, role, name };
}

export async function action({ request }: ActionFunctionArgs) {
  const requestContext = getRequestContext(request);
  const formData = Object.fromEntries(await request.formData());
  const input = {
    token: String(formData.token || ""),
    name: String(formData.name || ""),
    password: String(formData.password || ""),
    confirmPassword: String(formData.confirmPassword || ""),
  };

  const parsed = acceptInvitationSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<keyof AcceptInvitationInput, string>> = {};
    parsed.error.issues.forEach((issue) => {
      const field = issue.path[0] as keyof AcceptInvitationInput;
      if (field && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    });
    return { fieldErrors };
  }

  const result = await acceptInvitation(parsed.data, request);
  if (!result.ok) {
    return { formError: friendlyError(result.error) };
  }

  // This is the real accept path the invitation page submits to (the /api route is a
  // headless equivalent). Attribute the event to the newly-created user so the actor
  // column names them rather than showing "Unknown".
  fireAndForget(
    logAuditAction({
      ...getActorContext({ id: result.user.id, role: result.user.role }),
      ...requestContext,
      actionCode: "INVITATION_ACCEPTED",
      category: "INVITATION",
      entityType: "Invitation",
      entityId: result.invitationId,
      entityLabel: result.user.email,
      details: {
        role: result.user.role,
        email: result.user.email,
        acceptedUserId: result.user.id,
      },
    }),
  );

  const needsOnboarding = await userNeedsStudentIdOnboarding(result.user.id, result.user.role);
  const destination = needsOnboarding ? "/onboarding/student-id" : "/dashboard";
  return redirect(destination, { headers: result.headers });
}

export default function AcceptInvitationPage() {
  const navigation = useNavigation();
  const [password, setPassword] = useState("");
  // Covers the action submission and the post-accept redirect; resets to
  // "idle" automatically when the action returns an error.
  const isSubmitting = navigation.state !== "idle";
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData() as
    | {
        fieldErrors?: Partial<Record<keyof AcceptInvitationInput, string>>;
        formError?: string;
      }
    | undefined;

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="/" className="flex items-center gap-2 font-medium">
            <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
              <IconStack2 className="size-4" />
            </div>
            EduAI
          </a>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            {!data.ok ? (
              <div className="flex flex-col gap-4 text-center">
                <h1 className="text-xl font-semibold">Invitation unavailable</h1>
                <p className="text-sm text-muted-foreground">{data.error}</p>
                <a href="/auth/login" className="text-sm underline underline-offset-4">
                  Go to login
                </a>
              </div>
            ) : (
              <Form method="post" className="flex flex-col gap-6">
                <input type="hidden" name="token" value={data.token} />
                <div className="flex flex-col items-center gap-2 text-center">
                  <h1 className="text-2xl font-bold">Accept your invitation</h1>
                  <p className="text-muted-foreground text-sm">
                    You've been invited to join EduAI as{" "}
                    <strong>{ROLE_LABELS[data.role] ?? data.role}</strong>. Set a
                    password to activate your account.
                  </p>
                </div>

                {actionData?.formError && (
                  <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded text-sm">
                    {actionData.formError}
                  </div>
                )}

                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <label htmlFor="email" className="text-sm font-medium">
                      Email
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={data.email}
                      readOnly
                      className="border-input bg-muted text-muted-foreground flex h-9 w-full rounded-md border px-3 py-1 text-sm"
                    />
                  </div>

                  <div className="grid gap-2">
                    <label htmlFor="name" className="text-sm font-medium">
                      Full name
                    </label>
                    <input
                      id="name"
                      name="name"
                      type="text"
                      defaultValue={data.name ?? ""}
                      required
                      className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm"
                    />
                    {actionData?.fieldErrors?.name && (
                      <p className="text-sm text-red-600">{actionData.fieldErrors.name}</p>
                    )}
                  </div>

                  <div className="grid gap-2">
                    <label htmlFor="password" className="text-sm font-medium">
                      Password
                    </label>
                    <input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      required
                      aria-describedby="invitation-password-requirements"
                      onChange={(event) => setPassword(event.currentTarget.value)}
                      className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm"
                    />
                    <PasswordRequirements
                      password={password}
                      id="invitation-password-requirements"
                    />
                    {actionData?.fieldErrors?.password && (
                      <p className="text-sm text-red-600" role="alert">
                        {actionData.fieldErrors.password}
                      </p>
                    )}
                  </div>

                  <div className="grid gap-2">
                    <label htmlFor="confirmPassword" className="text-sm font-medium">
                      Confirm password
                    </label>
                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      required
                      className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm"
                    />
                    {actionData?.fieldErrors?.confirmPassword && (
                      <p className="text-sm text-red-600">
                        {actionData.fieldErrors.confirmPassword}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 w-full items-center justify-center rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    {isSubmitting ? "Creating…" : "Activate account"}
                  </button>
                </div>
              </Form>
            )}
          </div>
        </div>
      </div>
      <div className="bg-muted relative hidden lg:block">
        <img
          src="/placeholder.svg"
          alt="Image"
          className="absolute inset-0 h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
        />
      </div>
    </div>
  )
}
