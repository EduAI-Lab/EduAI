import { describe, expect, it } from "vitest";
import { IconListCheck, IconMessageChatbot, IconPuzzle } from "@tabler/icons-react";

import type { LauncherApp } from "@eduai/ui";
import { ADMIN_ROLES, extensionEntries, extensionIcon } from "~/components/layout/core-nav-model";

const app = (id: string, url = `https://${id}.test/`): LauncherApp =>
  ({ id, name: `App ${id}`, url }) as LauncherApp;

describe("extensionIcon", () => {
  it("knows AI Tutor and Question Maker, and gives anything else the puzzle piece", () => {
    expect(extensionIcon("ai-tutor")).toBe(IconMessageChatbot);
    expect(extensionIcon("question-maker")).toBe(IconListCheck);
    expect(extensionIcon("example")).toBe(IconPuzzle);
  });
});

describe("extensionEntries", () => {
  it("links each launchable extension, leaving out Core, Course Chat and URL-less apps", () => {
    const entries = extensionEntries([
      app("core"),
      app("course-chat"),
      app("ai-tutor"),
      app("question-maker", ""),
      app("example"),
    ]);
    expect(entries).toEqual([
      {
        kind: "link",
        link: {
          key: "app-ai-tutor",
          label: "App ai-tutor",
          href: "https://ai-tutor.test/",
          icon: IconMessageChatbot,
          external: true,
        },
      },
      {
        kind: "link",
        link: {
          key: "app-example",
          label: "App example",
          href: "https://example.test/",
          icon: IconPuzzle,
          external: true,
        },
      },
    ]);
  });

  it("is empty when no extension is configured", () => {
    expect(extensionEntries([app("core"), app("course-chat")])).toEqual([]);
  });
});

describe("ADMIN_ROLES", () => {
  it("covers only the admin roles, which keep the app switcher as the way to other apps", () => {
    expect([...ADMIN_ROLES].sort()).toEqual(["ADMIN", "UNIT_ADMIN"]);
  });
});
