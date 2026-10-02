/**
 * @file NotFoundState — the 404 page Question Maker shows for a URL that matches
 * no route, matching AI Tutor's and Core's. Rendered by the catch-all route under
 * `QmAppLayout`, so the sidebar and header stay mounted and the reader can
 * navigate onwards.
 */
import { Link } from "react-router";
import { Button, Card, EmptyState } from "@eduai/ui";
import { IconArrowLeft, IconSearchOff } from "@tabler/icons-react";

export function NotFoundState() {
  return (
    <div className="px-4 pt-6 pb-8 lg:px-6">
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
    </div>
  );
}
