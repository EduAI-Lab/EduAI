import { useLocalUser } from "~/hooks/useLocalUser";
import { HelpView } from "~/components/help/HelpView";
import { useShellBreadcrumbs } from "~/components/layout/ShellBreadcrumbContext";
import { requireClientUser } from "~/lib/client-auth";
import type { Route } from "./+types/help";
import { RouteErrorState } from "~/components/common/RouteErrorState";

export async function clientLoader(_: Route.ClientLoaderArgs) {
  await requireClientUser();
}

export default function HelpPage() {
  const { user } = useLocalUser();

  useShellBreadcrumbs([{ label: "Help" }]);

  return <HelpView role={user?.role} />;
}

/**
 * A missing record, a malformed id, or a route this role may not open all land
 * on the generic 404 inside the shell — see `RouteErrorState`.
 */
export { RouteErrorState as ErrorBoundary };
