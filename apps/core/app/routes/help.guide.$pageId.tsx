/**
 * `/help/guide/:pageId` — one user-guide page, in-app (#1819).
 *
 * This is what makes every help-assistant citation a real link: a page with no
 * route is not citable, and a citation that dead-ends is worse than none. The
 * page id goes through the same allowlist and role slices as retrieval, so a
 * student following (or guessing) an instructor-only page id gets the ordinary
 * 404 rather than the page.
 */
import { Link, redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Markdown,
} from "@eduai/ui";

import { CoreAppShell } from "~/components/layout/core-app-shell";
import {
  HELP_DOC_SOURCES,
  findAllowedHelpPage,
  helpDocTitle,
  helpDocUrl,
  helpPagesForSlices,
} from "~/lib/assistant/help-docs/manifest";
import { resolvedHelpPage } from "~/lib/assistant/help-docs/sources.server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { visibleHelpSlices } from "~/lib/help/role-slices";
import { notFound } from "~/lib/not-found.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);
  if (!session?.user) return redirect("/auth/login");

  const slices = visibleHelpSlices(session.user.role);
  const page = findAllowedHelpPage(params.pageId ?? "", slices);
  const resolved = page ? resolvedHelpPage(page.id) : null;
  if (!page || !resolved) throw notFound(session.user);

  const related = helpPagesForSlices(slices)
    .filter((entry) => entry.source === page.source && entry.id !== page.id)
    .map((entry) => ({ id: entry.id, title: helpDocTitle(entry), url: helpDocUrl(entry.id) }));

  return {
    user: session.user,
    page: {
      id: page.id,
      title: resolved.title,
      sourceLabel: HELP_DOC_SOURCES[page.source].label,
      content: resolved.content,
    },
    related,
  };
}

/**
 * Links inside a guide either leave the app (opened in a new tab) or point at
 * another repository Markdown file, which has no route here — those render as
 * plain text rather than a dead link.
 */
function GuideLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  if (href && /^https?:\/\//i.test(href)) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary-text underline"
      >
        {children}
      </a>
    );
  }
  return <span>{children}</span>;
}

export default function HelpGuidePage() {
  const { user, page, related } = useLoaderData<typeof loader>();

  return (
    <CoreAppShell
      user={user}
      breadcrumbs={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/help">Help &amp; guide</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{page.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      <div className="grid gap-6 px-4 pt-6 pb-10 lg:grid-cols-[1fr_240px] lg:px-6">
        <article className="min-w-0 rounded-[var(--radius-xl)] border border-border bg-card p-6 shadow-[var(--shadow-2xs)]">
          <p className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
            {page.sourceLabel}
          </p>
          <h1 className="mb-4 text-2xl font-semibold text-foreground">{page.title}</h1>
          <div className="prose-sm max-w-none text-sm leading-relaxed text-foreground">
            <Markdown components={{ a: GuideLink }}>{page.content}</Markdown>
          </div>
        </article>
        {related.length > 0 ? (
          <nav aria-label="More from this guide" className="lg:sticky lg:top-20 lg:self-start">
            <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
              More from the {page.sourceLabel.toLowerCase()}
            </p>
            <ul className="flex flex-col gap-1">
              {related.map((entry) => (
                <li key={entry.id}>
                  <Link
                    to={entry.url}
                    className="block rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {entry.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </CoreAppShell>
  );
}

export { RouteErrorState as ErrorBoundary } from "~/components/shared/route-error-state";
