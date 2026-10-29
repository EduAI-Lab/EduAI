import { useRouteLoaderData } from "react-router";
import { IconBooks, IconHelp, IconHistory, IconMessagePlus, IconRobot } from "@tabler/icons-react";

import type { NavShellEntry, NavShellModel } from "@eduai/ui";
import { ChatHistoryList, type ChatHistoryListProps } from "~/components/chat/chat-history-list";
import { loadNavCourses, useSharedNavParts } from "~/components/layout/core-nav-model";
import type { User } from "~/lib/auth/types";
import type { loader as rootLoader } from "~/root";

/** Course Chat's id in the shared launcher registry. */
export const COURSE_CHAT_APP_ID = "course-chat";

/**
 * Course Chat's pages. They live in Core, but the shell presents them as an
 * app of their own (#1996): its own switcher tile and its own rail.
 */
export function isCourseChatPath(pathname: string): boolean {
  return /^\/(?:instructor\/)?chat(?:\/[^/]*)?\/?$/.test(pathname);
}

export type CourseChatNavOptions = {
  /** The chat page's history list, shown as the rail's History tray. */
  history?: Omit<ChatHistoryListProps, "className">;
  /** Starts a new chat in place; without it New chat is a plain link to `/chat`. */
  onNewChat?: () => void;
};

const loadChatNavCourses = () =>
  loadNavCourses((courseId) => `/chat?courseId=${encodeURIComponent(courseId)}`);

/**
 * Course Chat's rail: New chat, History (when the page has it), Courses (each
 * opens a chat about that course), Course Assistant for the staff the root
 * loader allows, and Help. No Dashboard or Administration: those are Core's.
 */
export function useCourseChatNavModel(
  user: User,
  onReportBug: (() => void) | undefined,
  { history, onNewChat }: CourseChatNavOptions,
): NavShellModel {
  const shared = useSharedNavParts(user, onReportBug);
  const rootData = useRouteLoaderData<typeof rootLoader>("root");

  const entries: NavShellEntry[] = [
    {
      kind: "link",
      link: {
        key: "new-chat",
        label: "New chat",
        href: "/chat",
        icon: IconMessagePlus,
        onClick: onNewChat
          ? (event) => {
              event.preventDefault();
              onNewChat();
            }
          : undefined,
      },
    },
  ];
  if (history) {
    entries.push({
      kind: "panel",
      key: "history",
      label: "History",
      icon: IconHistory,
      render: (close) => (
        <ChatHistoryList
          {...history}
          onSelect={(chatId) => {
            close();
            history.onSelect(chatId);
          }}
        />
      ),
    });
  }
  entries.push({ kind: "tray", tray: "courses", label: "Courses", icon: IconBooks });
  if (rootData?.canUseCourseAssistant) {
    entries.push({
      kind: "link",
      link: {
        key: "instructor-chat",
        label: "Course Assistant",
        href: "/instructor/chat",
        icon: IconRobot,
      },
    });
  }
  entries.push({ kind: "tray", tray: "help", label: "Help", icon: IconHelp });

  return {
    ...shared,
    entries,
    adminLinks: [],
    loadCourses: loadChatNavCourses,
    currentAppId: COURSE_CHAT_APP_ID,
  };
}
