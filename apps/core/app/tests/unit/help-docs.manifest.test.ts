// @vitest-environment node
/**
 * #1819 guardrails over the REAL guides on disk:
 * - every section with body text is indexed or explicitly excluded, so a page
 *   added without indexing fails CI immediately;
 * - every manifest page resolves to a section, ids are unique and URL-safe;
 * - role slices are cumulative and a student can never reach an instructor- or
 *   admin-only page through the allowlist;
 * - the allowlist drops traversal-shaped and cross-role ids;
 * - #1824: every intro example names a page in the asking role's own slice.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { findMonorepoRoot } from "../../../vitest.shared";
import {
  EXCLUDED_SECTIONS,
  HELP_DOC_PAGES,
  HELP_DOC_SOURCES,
  findAllowedHelpPage,
  helpDocUrl,
  helpPagesForSlices,
} from "~/lib/assistant/help-docs/manifest";
import { sectionsWithBody } from "~/lib/assistant/help-docs/sections";
import { resolvedHelpPages } from "~/lib/assistant/help-docs/sources.server";
import { canReadHelpSlice, visibleHelpSlices } from "~/lib/help/role-slices";
import {
  DOCS_EXAMPLES,
  buildAssistantIntro,
  docsExamplesForRole,
} from "~/components/assistant/intro-copy";

const root = findMonorepoRoot(__dirname);

function readSource(file: string) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

describe("help docs manifest guardrail", () => {
  it("indexes (or explicitly excludes) every section that exists on disk", () => {
    const unindexed: string[] = [];
    for (const [source, { file }] of Object.entries(HELP_DOC_SOURCES)) {
      for (const section of sectionsWithBody(readSource(file))) {
        const indexed = HELP_DOC_PAGES.some(
          (page) => page.source === source && page.heading === section.heading,
        );
        const excluded = EXCLUDED_SECTIONS.some(
          (entry) => entry.source === source && entry.heading === section.heading,
        );
        if (!indexed && !excluded) unindexed.push(`${file} → ${section.heading}`);
      }
    }
    expect(unindexed).toEqual([]);
  });

  it("resolves every manifest page to a section of its own source (no dangling rows)", () => {
    const resolved = resolvedHelpPages();
    const missing = HELP_DOC_PAGES.filter((page) => !resolved.has(page.id)).map((page) => page.id);
    expect(missing).toEqual([]);
  });

  it("bundles the same guide text that is on disk", () => {
    const pages = resolvedHelpPages();
    const page = pages.get("find-a-course");
    expect(readSource("docs/USER_GUIDE.md")).toContain(page?.content.split("\n")[0] ?? "∅");
  });

  it("has unique, URL-safe ids and every page has a real in-app URL", () => {
    const ids = HELP_DOC_PAGES.map((page) => page.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
      expect(helpDocUrl(id)).toBe(`/help/guide/${id}`);
    }
  });

  it("names unique headings within each source, so a heading identifies one section", () => {
    for (const { file } of Object.values(HELP_DOC_SOURCES)) {
      const headings = sectionsWithBody(readSource(file)).map((section) => section.heading);
      expect(new Set(headings).size).toBe(headings.length);
    }
  });

  it("gives every excluded section a reason", () => {
    for (const entry of EXCLUDED_SECTIONS) expect(entry.reason.length).toBeGreaterThan(10);
  });
});

describe("role slices", () => {
  it("are cumulative and shared by the help view and retrieval", () => {
    expect(visibleHelpSlices("STUDENT")).toEqual(["student"]);
    expect(visibleHelpSlices("INSTRUCTOR")).toEqual(["student", "instructor"]);
    expect(visibleHelpSlices("UNIT_ADMIN")).toEqual(["student", "instructor", "admin"]);
    expect(visibleHelpSlices("ADMIN")).toEqual(["student", "instructor", "admin"]);
    expect(visibleHelpSlices(undefined)).toEqual(["student"]);
    expect(canReadHelpSlice("STUDENT", "instructor")).toBe(false);
  });

  it("never lets a student reach an instructor-only or admin-only page", () => {
    const studentSlices = visibleHelpSlices("STUDENT");
    for (const page of HELP_DOC_PAGES.filter((entry) => entry.slice !== "student")) {
      expect(findAllowedHelpPage(page.id, studentSlices)).toBeNull();
    }
    expect(helpPagesForSlices(studentSlices).every((page) => page.slice === "student")).toBe(true);
  });
});

describe("the retrieval allowlist", () => {
  it.each([
    "../../../.env",
    "../USER_GUIDE.md",
    "docs/USER_GUIDE.md",
    "find-a-course/../platform-admin",
    "FIND-A-COURSE",
    " find-a-course",
    "",
  ])("drops traversal-shaped or inexact id %j", (id) => {
    expect(findAllowedHelpPage(id, visibleHelpSlices("ADMIN"))).toBeNull();
  });

  it("drops a cross-role id for a reader without that slice, and allows it for one with it", () => {
    expect(findAllowedHelpPage("platform-admin", visibleHelpSlices("INSTRUCTOR"))).toBeNull();
    expect(findAllowedHelpPage("platform-admin", visibleHelpSlices("ADMIN"))?.id).toBe(
      "platform-admin",
    );
  });
});

describe("intro copy (#1824)", () => {
  it.each(["STUDENT", "INSTRUCTOR", "UNIT_ADMIN", "ADMIN"])(
    "every %s example question resolves to a page in that role's own slice",
    (role) => {
      const slices = visibleHelpSlices(role);
      for (const example of docsExamplesForRole(role)) {
        expect(findAllowedHelpPage(example.pageId, slices)?.id).toBe(example.pageId);
      }
    },
  );

  it("every curated example points at a page of the slice it is filed under", () => {
    for (const [slice, examples] of Object.entries(DOCS_EXAMPLES)) {
      for (const example of examples) {
        expect(HELP_DOC_PAGES.find((page) => page.id === example.pageId)?.slice).toBe(slice);
      }
    }
  });

  it("the in-course variant still advertises platform help", () => {
    const intro = buildAssistantIntro({
      role: "STUDENT",
      scopeLabel: "CS101 — Intro",
      isMaterial: false,
      docs: true,
    });
    expect(intro.lines.join(" ")).toMatch(/how EduAI works/);
    expect(intro.examples.some((example) => example.kind === "docs")).toBe(true);
    expect(intro.examples.some((example) => example.kind === "material")).toBe(true);
  });

  it("offers no docs examples when only the material half is on", () => {
    const intro = buildAssistantIntro({
      role: "STUDENT",
      scopeLabel: "Week 1 notes",
      isMaterial: true,
      docs: false,
    });
    expect(intro.examples.every((example) => example.kind === "material")).toBe(true);
  });

  it("puts the instructor's own examples first", () => {
    expect(docsExamplesForRole("INSTRUCTOR")[0].pageId).toBe("canvas-sync");
    expect(docsExamplesForRole("ADMIN")[0].pageId).toBe("platform-admin");
  });
});
