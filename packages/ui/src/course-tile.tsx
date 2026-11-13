/**
 * @file The Canvas-style course card from Core's dashboard (#2105), shared so
 * Core, AI Tutor and Question Maker draw a course the same way: a colour
 * banner, "code · name", the term line, and an icon row of the places the
 * course opens in that app. Each app supplies its own links and menu.
 */
import * as React from "react";
import type { Icon } from "@tabler/icons-react";

import { courseThemeVars, type CourseAccentColor } from "./course-theme";
import { termLabel } from "./lib/term";
import { StatusBadge } from "./status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "./utils";

export type CourseTileLink = {
  key: string;
  label: string;
  icon: Icon;
  href?: string;
  /** A full page load (another app); otherwise `LinkComponent` navigates. */
  external?: boolean;
  /** Shown instead of a link when the destination can't open yet. */
  disabledReason?: string;
};

/**
 * A router link such as React Router's `Link` (rendered with `to`); without
 * one the card falls back to plain anchors.
 */
export type CourseTileLinkComponent = React.ElementType<{
  to: string;
  className?: string;
  children?: React.ReactNode;
}>;

/** Accent text blended toward the foreground so it keeps contrast in both themes. */
const ACCENT_TEXT = "text-[color-mix(in_oklch,var(--course-accent)_72%,var(--foreground))]";

function TileLink({
  href,
  external,
  LinkComponent,
  className,
  children,
}: {
  href: string;
  external?: boolean;
  LinkComponent?: CourseTileLinkComponent;
  className: string;
  children: React.ReactNode;
}) {
  if (external || !LinkComponent) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <LinkComponent to={href} className={className}>
      {children}
    </LinkComponent>
  );
}

/** Cards show icon buttons (Canvas-style) named by a tooltip; list rows also show the label. */
export function CourseTileLinkButton({
  link,
  iconOnly,
  LinkComponent,
}: {
  link: CourseTileLink;
  iconOnly?: boolean;
  LinkComponent?: CourseTileLinkComponent;
}) {
  const className = cn(
    "relative z-10 inline-flex items-center gap-1.5 rounded-md text-xs font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    iconOnly ? "size-9 justify-center" : "px-2 py-1.5",
  );
  const content = (
    <>
      <link.icon className={iconOnly ? "size-5" : "size-4 shrink-0"} aria-hidden="true" />
      <span className={cn(iconOnly && "sr-only")}>{link.label}</span>
    </>
  );
  const tip = link.href ? link.label : `${link.label}: ${link.disabledReason}`;
  const control = link.href ? (
    <TileLink
      href={link.href}
      external={link.external}
      LinkComponent={LinkComponent}
      className={cn(className, ACCENT_TEXT, "hover:bg-[var(--course-muted)]")}
    >
      {content}
    </TileLink>
  ) : (
    <span
      aria-disabled="true"
      tabIndex={0}
      className={cn(className, "cursor-not-allowed text-muted-foreground/60")}
    >
      {content}
    </span>
  );
  if (!iconOnly && link.href) return control;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{control}</TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

export type CourseTileProps = {
  code: string;
  /** The course name (or the viewer's nickname for it). */
  title: string;
  term: string;
  year: number | null;
  accent: CourseAccentColor;
  /** Where the card itself opens; the title link stretches over the card. */
  href: string;
  LinkComponent?: CourseTileLinkComponent;
  links: CourseTileLink[];
  /** Shows the Published / Unpublished badge (staff cards). */
  publishState?: boolean;
  /** Extra items on the term line, e.g. a learner's progress. */
  meta?: React.ReactNode;
  /** Pills on the term line, e.g. the viewer's role or the teaching team. */
  extraBadges?: string[];
  /** Drawn at the banner's top right (a ⋮ menu or the customise popover). */
  menu?: React.ReactNode;
  /** One level below whatever heading the card sits under. */
  headingLevel?: 3 | 4;
  /** Extra attributes for the card's root (e.g. guided-tour anchors). */
  rootProps?: React.HTMLAttributes<HTMLElement> & Record<`data-${string}`, string>;
};

export function CourseTile({
  code,
  title,
  term,
  year,
  accent,
  href,
  LinkComponent,
  links,
  publishState,
  meta,
  extraBadges,
  menu,
  headingLevel = 3,
  rootProps,
}: CourseTileProps) {
  const heading = code && title ? `${code} · ${title}` : code || title;
  const Heading = headingLevel === 4 ? "h4" : "h3";
  return (
    <article
      {...rootProps}
      className="group/card relative flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xs transition-shadow focus-within:shadow-md hover:shadow-md"
      style={courseThemeVars(accent)}
    >
      <div className="relative h-24 shrink-0" style={{ background: accent }}>
        {menu && <div className="absolute right-2 top-2 z-10">{menu}</div>}
      </div>
      <div className="flex flex-1 flex-col gap-1 px-4 pt-3 pb-2">
        <Heading className="line-clamp-2 text-[15px] font-semibold leading-snug">
          <TileLink
            href={href}
            LinkComponent={LinkComponent}
            className={cn(
              ACCENT_TEXT,
              "after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring",
            )}
          >
            {heading}
          </TileLink>
        </Heading>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{termLabel(term, year)}</span>
          {publishState !== undefined && (
            <StatusBadge
              active={publishState}
              activeLabel="Published"
              inactiveLabel="Unpublished"
            />
          )}
          {meta}
          {extraBadges?.map((badge) => (
            // The same pill the older shared CourseCard used for these.
            <span
              key={badge}
              className="inline-flex items-center rounded-full border border-[var(--course-border)] bg-[var(--course-muted)] px-2 py-0.5 text-[11px] font-medium leading-none text-foreground/80"
            >
              {badge}
            </span>
          ))}
        </div>
      </div>
      {links.length > 0 && (
        <nav
          aria-label={`${code || title} sections`}
          className="flex items-center gap-1 border-t border-border px-2 py-1"
        >
          {links.map((link) => (
            <CourseTileLinkButton
              key={link.key}
              link={link}
              iconOnly
              LinkComponent={LinkComponent}
            />
          ))}
        </nav>
      )}
    </article>
  );
}
