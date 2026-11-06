import { useEffect, useState } from "react";
import canvasService from "@/services/canvasService";

const EMPTY: ReadonlySet<number> = new Set();

// shortcut: one mapping call per course card, cached per session; upgrade to a batched field on the course list if admins' lists get long
const linkCache = new Map<number, boolean>();

export function __resetCanvasLinkCache(): void {
  linkCache.clear();
}

// shortcut: only the first 48 ids are looked up (cards past that show no Canvas shortcut; the Canvas tab stays on the course page), upgrade to a batched endpoint when lists outgrow it
export const CANVAS_LINK_LIMIT = 48;

/** Ids of the given courses that are linked to a Canvas course. */
export function useCanvasLinks(courseIds: number[], enabled: boolean): ReadonlySet<number> {
  const [linked, setLinked] = useState<ReadonlySet<number>>(EMPTY);
  const key = courseIds.slice(0, CANVAS_LINK_LIMIT).join(",");

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const ids = key ? key.split(",").map(Number) : [];
    const missing = ids.filter((id) => !linkCache.has(id));
    const publish = () => {
      if (!cancelled) setLinked(new Set(ids.filter((id) => linkCache.get(id))));
    };
    publish();
    if (missing.length === 0) return () => void (cancelled = true);
    void Promise.all(
      missing.map(async (id) => {
        const link = await canvasService.getCourseLink(id);
        // "unknown" is a failed lookup, not an answer: leave it uncached so a remount retries.
        if (link.status !== "unknown") linkCache.set(id, link.status === "linked");
      }),
    ).then(publish);
    return () => void (cancelled = true);
  }, [key, enabled]);

  return enabled ? linked : EMPTY;
}
