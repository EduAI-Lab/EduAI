/**
 * @file NotFoundState — the one 404 page Core, AI Tutor and Question Maker show.
 *
 * Deliberately generic. It stands in for three situations:
 *
 *   - a URL that matches no route,
 *   - a real route pointed at a record that doesn't exist (or a malformed id),
 *   - a page the signed-in user isn't allowed to open.
 *
 * Answering all three the same way means no app ever confirms that a page
 * exists to someone who cannot open it, and keeping one copy here means the
 * three apps cannot drift apart on how that answer looks.
 *
 * `standalone` centres it on a bare page for boundaries above an app shell;
 * the default form sits inside the shell, so the sidebar and header stay
 * mounted. Pass the app's router link as `LinkComponent` (this package does
 * not depend on a router), the same way `AppSidebar` takes one.
 */
import type * as React from "react";
import { IconArrowLeft, IconSearchOff } from "@tabler/icons-react";

import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { EmptyState } from "./empty-state";

export interface NotFoundStateProps {
  /** Render centred on a bare page, for boundaries outside the app shell. */
  standalone?: boolean;
  /** Where "Go to dashboard" leads (default "/dashboard"). */
  homeHref?: string;
  /** The app's router link (e.g. react-router's `Link`); a plain `<a>` by default. */
  LinkComponent?: React.ElementType;
}

export function NotFoundState({
  standalone = false,
  homeHref = "/dashboard",
  LinkComponent = "a",
}: NotFoundStateProps) {
  const body = (
    <Card>
      <EmptyState
        icon={<IconSearchOff size={22} aria-hidden="true" />}
        title="404 — Page not found"
        description="This page doesn't exist, or you don't have access to it. Check the link and try again."
        action={
          <Button asChild variant="outline">
            <LinkComponent to={homeHref} href={homeHref}>
              <IconArrowLeft className="size-4" aria-hidden="true" />
              Go to dashboard
            </LinkComponent>
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
