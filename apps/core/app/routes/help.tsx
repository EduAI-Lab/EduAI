import { redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { CoreAppShell } from "~/components/layout/core-app-shell";
import { HelpView } from "~/components/help/help-view";
import { getRequestSession } from "~/lib/auth/request-session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);
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
