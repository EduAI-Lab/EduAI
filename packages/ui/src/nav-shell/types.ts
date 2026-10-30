import type * as React from "react";
import type { Icon } from "@tabler/icons-react";

import type { LauncherApp } from "../app-launcher";

/**
 * The rail entries that open a tray (desktop/tablet) or an accordion (mobile).
 * "apps" is the app switcher at the top of the rail; on mobile it is a bottom
 * sheet from the header instead.
 */
export type NavTrayKey = "account" | "apps" | "courses" | "admin" | "help";

/** The open tray: a built-in one, or an app-supplied panel (`panel:<key>`). */
export type NavOpenTray = NavTrayKey | `panel:${string}`;

export type NavShellLink = {
  key: string;
  label: string;
  href: string;
  icon?: Icon;
  /** Leaves the app (another EduAI app, an external doc): a plain anchor, never the router link. */
  external?: boolean;
  /** Greyed-out and non-navigating (an admin policy turned it off, #807). */
  disabled?: boolean;
  disabledReason?: string;
  /** Trailing status marker, e.g. Core's cron-health dot. */
  badge?: React.ReactNode;
  /**
   * Runs before the link navigates; call `preventDefault()` to handle it in
   * place (e.g. Course Chat's New chat, which has to stop a streaming reply).
   */
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
};

export type NavShellEntry =
  | { kind: "link"; link: NavShellLink }
  | { kind: "tray"; tray: Exclude<NavTrayKey, "account" | "apps">; label: string; icon: Icon }
  /**
   * A tray whose contents the app draws (e.g. Course Chat's History). `render`
   * gets a `close` to call once its content has done its job.
   */
  | {
      kind: "panel";
      key: string;
      label: string;
      icon: Icon;
      render: (close: () => void) => React.ReactNode;
    };

export type NavShellCourse = {
  id: string;
  href: string;
  code: string;
  name: string;
  /** Pre-formatted term, e.g. "2026-27W1". */
  subtitle?: string;
};

export type NavShellCoursesState = {
  status: "idle" | "loading" | "ready" | "error";
  courses: NavShellCourse[];
};

/**
 * Everything the rail, its trays, and the mobile drawer draw, built by each app
 * from its own RBAC sources. The shell owns none of it: it only lays it out.
 */
export type NavShellModel = {
  /** The current path, for active tiles and `aria-current`. */
  pathname: string;
  user: {
    name: string;
    email: string;
    image?: string | null;
    /** An "Admin" badge is shown for ADMIN only. */
    role?: string | null;
  };
  /** Everything below the Account entry, in rail order. */
  entries: NavShellEntry[];
  /** Account tray links above the theme switch (Settings, Back to EduAI, …). */
  accountLinks: NavShellLink[];
  /** Administration tray contents; only read when `entries` holds the admin tray. */
  adminLinks: NavShellLink[];
  /** Help tray links; "Report a bug" is added after them when `onReportBug` is set. */
  helpLinks: NavShellLink[];
  /** The Courses tray's "All courses" link; left out when absent. */
  coursesHref?: string;
  /**
   * Fetches the Courses tray list. Called on the tray's first open (most visits
   * never open it), and again after a failure. Ignored when `courses` is set.
   */
  loadCourses?: () => Promise<NavShellCourse[]>;
  /** The Courses tray list, for an app that already holds it in memory. */
  courses?: NavShellCoursesState;
  /**
   * Apps the user may switch to, the current one included (marked by
   * `currentAppId`). The current app's icon is the rail's top tile and the
   * mobile header's switcher.
   */
  launcherApps: LauncherApp[];
  currentAppId: string;
  onLogout: () => void;
  onReportBug?: () => void;
};

/** What the shell needs to draw a course page's menu, breadcrumb, and drawer section. */
export type CourseNavItem = {
  key: string;
  label: string;
  href: string;
  disabled?: boolean;
  disabledReason?: string;
  /** Product-tour anchor (`data-tour`) carried over from the tab it replaced. */
  tourId?: string;
};

export type CourseNavConfig = {
  /** The course's landing section, linked from the breadcrumb. */
  href: string;
  code: string;
  /** Pre-formatted term, e.g. "2026-27W1". */
  term: string;
  items: CourseNavItem[];
  activeKey: string | null;
  /**
   * A page below the active section (e.g. "Edit question"): adds a last
   * breadcrumb, and the section crumb before it becomes a link.
   */
  subPage?: string;
  /**
   * Replaces the course crumb (e.g. AI Tutor's course switcher, which its
   * other course pages also carry in their breadcrumb).
   */
  courseCrumb?: React.ReactNode;
};

/**
 * The app's router link (React Router's `Link`). It receives both `to` and
 * `href`, so a plain `"a"` also works.
 */
export type NavLinkComponent = React.ElementType;
