/**
 * The admin console's sections. They share one route (`/admin`) and are picked
 * by `?tab=`, so the shell's Administration menu and the page read the same
 * list; an unknown or missing value opens Bug reports.
 */
export const ADMIN_SECTIONS = [
  { key: "bug-reports", label: "Bug reports" },
  { key: "ai-settings", label: "AI settings" },
  { key: "ai-oversight", label: "AI oversight" },
] as const;

export type AdminSectionKey = (typeof ADMIN_SECTIONS)[number]["key"];

/** `search` is a location's query string (`?tab=…`) or its parsed params. */
export function adminSectionFrom(search: string | URLSearchParams): AdminSectionKey {
  const tab = new URLSearchParams(search).get("tab");
  return ADMIN_SECTIONS.find((section) => section.key === tab)?.key ?? "bug-reports";
}

export const adminSectionHref = (key: AdminSectionKey) => `/admin?tab=${key}`;
