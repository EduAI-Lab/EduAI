/**
 * @file The assistant gate (#1817): which reference material may the read-only
 * assistant ground an answer in, for this reader, on this page.
 *
 * The widget's render condition (root loader), the bubble's visibility on a
 * course page (that page's loader) and `POST /api/assistant/ask` all read these
 * functions, so the icon can never promise an answer the endpoint refuses.
 *
 * A plain service, deliberately NOT an RBAC ability with an admin bypass: the
 * kill switch must bind administrators too. That is also why the platform switch
 * `ai.platformEnabled` is checked first — an admin freezing AI during a cost or
 * provider incident expects every assistant call to stop, including their own.
 */
import type { AssistantSettings } from "~/lib/assistant/assistant-settings";
import { getAssistantSettings } from "~/lib/assistant/assistant-settings.server";
import type { AssistantGateSnapshot } from "~/lib/assistant/assistant-visibility";
import type { PageContextResolution } from "~/lib/assistant/material-context.server";
import {
  catalogueHasEnabledProvider,
  loadAssistantCatalogue,
  type CatalogueProvider,
} from "~/lib/assistant/provider-choice.server";
import { getPolicy } from "~/lib/policy.server";

export type AssistantAvailability = {
  /** The platform AI kill switch (`ai.platformEnabled`). */
  platformEnabled: boolean;
  settings: AssistantSettings;
  /** At least one active provider with an admin-allowed chat model. */
  hasEnabledProvider: boolean;
};

export type AssistantScope = { docs: boolean; material: boolean };

/** Platform roles that keep material grounding with the student toggle off. */
const STAFF_ROLES = new Set(["INSTRUCTOR", "ADMIN", "UNIT_ADMIN"]);

function aiCallsAllowed(availability: AssistantAvailability): boolean {
  // Never advertise a source whose request could only be refused.
  return availability.platformEnabled && availability.hasEnabledProvider;
}

/** The documentation half: switch on, AI not frozen, and something to answer with. */
export function docsSourceAvailable(availability: AssistantAvailability): boolean {
  return aiCallsAllowed(availability) && availability.settings.enableHelpAssistant;
}

/**
 * The context-independent half of the material source, asked once by the global
 * mount point before any course is known. `true` only keeps the widget mounted;
 * it never grants material context by itself.
 */
export function materialSourcePossible(
  availability: AssistantAvailability,
  role: string | null | undefined,
): boolean {
  if (!aiCallsAllowed(availability)) return false;
  return availability.settings.enableStudentMaterialQuestions || STAFF_ROLES.has(role ?? "");
}

/**
 * The material half for a resolved page: the course allows AI, this reader may
 * actually view it, and either students may ask or this reader is the course's
 * own staff (instructor-or-above access to THIS course).
 */
export function materialSourceAvailable(
  availability: AssistantAvailability,
  resolution: PageContextResolution,
): boolean {
  if (!aiCallsAllowed(availability)) return false;
  if (resolution.kind !== "resolved") return false;
  if (!resolution.courseAllowsAi || !resolution.canView || !resolution.access) return false;
  const staffOfCourse = resolution.access.rank >= 2;
  return availability.settings.enableStudentMaterialQuestions || staffOfCourse;
}

export function scopeFor(
  availability: AssistantAvailability,
  resolution: PageContextResolution | null,
): AssistantScope {
  return {
    docs: docsSourceAvailable(availability),
    material: resolution ? materialSourceAvailable(availability, resolution) : false,
  };
}

/** The root loader's snapshot for the widget mount point. */
export function gateSnapshot(
  availability: AssistantAvailability,
  role: string | null | undefined,
): AssistantGateSnapshot {
  const docs = docsSourceAvailable(availability);
  return { mounted: docs || materialSourcePossible(availability, role), docs };
}

const CATALOGUE_TTL_MS = 10 * 1000;
let catalogueCache: { value: CatalogueProvider[]; expiresAt: number } | null = null;

/** The catalogue, cached briefly: the root loader asks on every navigation. */
export async function cachedAssistantCatalogue(): Promise<CatalogueProvider[]> {
  if (catalogueCache && Date.now() < catalogueCache.expiresAt) return catalogueCache.value;
  const value = await loadAssistantCatalogue();
  catalogueCache = { value, expiresAt: Date.now() + CATALOGUE_TTL_MS };
  return value;
}

export function invalidateAssistantCatalogueCache(): void {
  catalogueCache = null;
}

export async function loadAssistantAvailability(): Promise<AssistantAvailability> {
  const [platformEnabled, settings, catalogue] = await Promise.all([
    getPolicy("ai.platformEnabled"),
    getAssistantSettings(),
    cachedAssistantCatalogue(),
  ]);
  return {
    platformEnabled,
    settings,
    hasEnabledProvider: catalogueHasEnabledProvider(catalogue),
  };
}

/**
 * The root loader's call. Never throws: a settings read failure must not take
 * every page down with it, so it reports the assistant as absent instead.
 */
export async function loadAssistantGateSnapshot(
  role: string | null | undefined,
): Promise<AssistantGateSnapshot> {
  try {
    return gateSnapshot(await loadAssistantAvailability(), role);
  } catch (cause) {
    console.warn("[assistant/gate] availability check failed; hiding the assistant", {
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return { mounted: false, docs: false };
  }
}
