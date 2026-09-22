import { redirect, useLoaderData, useRevalidator } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { AiStatusPageView } from "~/components/ai/ai-status-page-view";
import { CoreAppShell } from "~/components/layout/core-app-shell";
import { classifyCloudStatus } from "~/lib/ai/service-status.server";
import { loadHistoryPayload } from "~/lib/ai/status/history.server";
import { getUbcStatusCached } from "~/lib/ai/status/read.server";
import { getRequestSession } from "~/lib/auth/request-session.server";

/** The window the page advertises; the panel's popover shows the same one. */
const WINDOW_HOURS = 72;

/**
 * `/status` — the full AI-service status page, opened from the UBC header chip
 * (#764 follow-on).
 *
 * Reads the same persisted snapshot `/api/ai-status` and
 * `/api/ai-status/history` serve, but in the loader rather than over HTTP: the
 * page arrives with its data, so there is no spinner, no cold-start flash and
 * no client fetch. Available to any signed-in user — status exposes only
 * up/down state, never hostnames or fleet ids.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);
  if (!session?.user) {
    return redirect("/auth/login");
  }

  const [payload, ubcRead] = await Promise.all([
    loadHistoryPayload({ hours: WINDOW_HOURS }),
    getUbcStatusCached(),
  ]);

  return {
    user: session.user,
    payload,
    ubc: ubcRead.status,
    checkedAt: ubcRead.checkedAt,
    stale: ubcRead.stale,
    cloud: classifyCloudStatus({
      openai: process.env.OPENAI_API_KEY,
      google: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
    }),
  };
}

export default function StatusPage() {
  const { user, payload, ubc, cloud, checkedAt, stale } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  return (
    <CoreAppShell user={user} title="AI service status">
      <AiStatusPageView
        payload={payload}
        ubc={ubc}
        cloud={cloud}
        checkedAt={checkedAt}
        stale={stale}
        onRefresh={() => revalidator.revalidate()}
      />
    </CoreAppShell>
  );
}
