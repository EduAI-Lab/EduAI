/**
 * @file Load the indexed guides and resolve each manifest page to its text (#1819).
 *
 * The guides are bundled at build time (`?raw`), so a deployment never depends on
 * the repository's `docs/` folder being present at runtime, and an edit to a guide
 * ships with the next build — the corpus hash then changes and the index rebuilds
 * itself. The Dockerfile copies these two files into the build stage for this.
 */
import { createHash } from "node:crypto";

import userGuide from "../../../../../../docs/USER_GUIDE.md?raw";
import instructorOnboarding from "../../../../../../docs/INSTRUCTOR_ONBOARDING.md?raw";

import {
  HELP_DOC_PAGES,
  helpDocTitle,
  helpDocUrl,
  type HelpDocPage,
  type HelpDocSourceId,
} from "~/lib/assistant/help-docs/manifest";
import { sectionsWithBody } from "~/lib/assistant/help-docs/sections";
import type { HelpSlice } from "~/lib/help/role-slices";

const RAW_SOURCES = {
  "user-guide": userGuide,
  "instructor-onboarding": instructorOnboarding,
} satisfies Record<HelpDocSourceId, string>;

export function rawHelpSource(source: HelpDocSourceId): string {
  return RAW_SOURCES[source];
}

/** A manifest page with its text resolved from its own source section. */
export type ResolvedHelpPage = {
  id: string;
  title: string;
  url: string;
  slice: HelpSlice;
  content: string;
};

let resolvedCache: Map<string, ResolvedHelpPage> | null = null;

function resolvePage(page: HelpDocPage): ResolvedHelpPage | null {
  const section = sectionsWithBody(rawHelpSource(page.source)).find(
    (entry) => entry.heading === page.heading,
  );
  if (!section) {
    // A manifest row naming a heading that no longer exists degrades to "not
    // indexed" rather than throwing; the manifest test fails CI for it.
    console.warn("[assistant/help-docs] manifest page has no matching section", {
      pageId: page.id,
    });
    return null;
  }
  return {
    id: page.id,
    title: helpDocTitle(page),
    url: helpDocUrl(page.id),
    slice: page.slice,
    content: section.body,
  };
}

/** Every resolvable page, by id. Built once per process — the sources are bundled. */
export function resolvedHelpPages(): Map<string, ResolvedHelpPage> {
  if (!resolvedCache) {
    resolvedCache = new Map();
    for (const page of HELP_DOC_PAGES) {
      const resolved = resolvePage(page);
      if (resolved) resolvedCache.set(page.id, resolved);
    }
  }
  return resolvedCache;
}

/** Content for one ALLOWLISTED page — callers pass an id that already passed the allowlist. */
export function resolvedHelpPage(pageId: string): ResolvedHelpPage | null {
  return resolvedHelpPages().get(pageId) ?? null;
}

/**
 * A hash over every page's id, slice and text plus the embedding space it will
 * be embedded into. Any change to a guide, the manifest, or the embedding
 * provider/model/dimension changes it, which is what triggers a rebuild.
 */
export function helpCorpusHash(embeddingSpace: string): string {
  const hash = createHash("sha256");
  hash.update(`space:${embeddingSpace}\n`);
  for (const page of resolvedHelpPages().values()) {
    hash.update(`${page.id}\u0000${page.slice}\u0000${page.title}\u0000${page.content}\u0001`);
  }
  return hash.digest("hex");
}
