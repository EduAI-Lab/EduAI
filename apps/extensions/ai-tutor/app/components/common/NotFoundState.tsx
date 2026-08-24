/**
 * @file NotFoundState — the one 404 page the app shows.
 *
 * Deliberately generic. It stands in for three situations that used to look
 * different from each other:
 *
 *   - a URL that matches no route,
 *   - a real route pointed at a record that doesn't exist (or a malformed id),
 *   - a route the signed-in user isn't allowed to open.
 *
 * The last one used to bounce the reader to `/` with no explanation, which
 * reads as a glitch. Answering all three the same way also means the app never
 * confirms that a page exists to someone who cannot open it.
 *
 * Rendered in two places: `standalone` for boundaries above the app shell
 * (root.tsx), and the default in-shell form for routes under `_app.tsx`, where
 * the sidebar and header stay mounted and the reader can navigate onwards.
 */
import { Link } from "react-router";
import { Button, Card, EmptyState } from "@eduai/ui";
import { IconArrowLeft, IconSearchOff } from "@tabler/icons-react";

export type NotFoundStateProps = {
  /** Render centred on a bare page, for boundaries outside the app shell. */
  standalone?: boolean;
};

export function NotFoundState({ standalone = false }: NotFoundStateProps) {
  const body = (
    <Card>
      <EmptyState
        icon={<IconSearchOff size={22} aria-hidden="true" />}
        title="404 — Page not found"
        description="This page doesn't exist, or you don't have access to it. Check the link and try again."
        action={
          <Button asChild variant="outline">
            <Link to="/dashboard">
              <IconArrowLeft className="size-4" aria-hidden="true" />
              Go to dashboard
            </Link>
          </Button>
        }
      />
    </Card>
  );

  if (standalone) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-xl">{body}</div>
      </main>
    );
  }

  return <div className="px-4 pt-6 pb-8 lg:px-6">{body}</div>;
}

/** Route element for the catch-all (`*`) route — an unmatched URL is a 404. */
export default function NotFoundRoute() {
  return <NotFoundState />;
}
