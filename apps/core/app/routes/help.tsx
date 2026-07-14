import { redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { CoreAppShell } from "~/components/layout/core-app-shell";
import { HelpView } from "~/components/help/help-view";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return redirect("/auth/login");
  }
  return { user: session.user };
}

export default function HelpPage() {
  const { user } = useLoaderData<typeof loader>();

  return (
    <CoreAppShell user={user} title="Help & guide">
      <HelpView role={user.role ?? undefined} />
    </CoreAppShell>
  );
}
