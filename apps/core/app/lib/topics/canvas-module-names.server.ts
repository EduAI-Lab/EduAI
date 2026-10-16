import { listCanvasCourseModules } from "~/lib/canvas/client.server";
import { requireCanvasCredentials } from "~/lib/canvas/courses.server";
import { extractCanvasModuleCandidates } from "~/lib/topics/canvas-modules";

type CanvasLookup = {
  canvasCourseId?: string | null;
  /** Owner of the Canvas credentials used to read modules. */
  userId: string;
  fetchImpl?: typeof fetch;
};

type CanvasMaterial = { id: string; externalId: string | null; externalSource: string | null };

/**
 * Canvas module names per material, or an empty map when the course is not
 * Canvas linked, the user has no stored credentials, or Canvas is unreachable.
 *
 * Shared by auto-matching (#1965) and on-demand suggestions (#1966). A Canvas
 * failure must not fail either job: headings and the model still work.
 */
export async function canvasModuleNamesByMaterial(
  args: CanvasLookup,
  materials: CanvasMaterial[],
): Promise<Map<string, string[]>> {
  const byMaterial = new Map<string, string[]>();
  if (!args.canvasCourseId) return byMaterial;

  const materialIdByCanvasFileId = new Map<string, string>();
  for (const material of materials) {
    if (material.externalSource === "canvas" && material.externalId) {
      materialIdByCanvasFileId.set(material.externalId, material.id);
    }
  }
  if (materialIdByCanvasFileId.size === 0) return byMaterial;

  try {
    const credentials = await requireCanvasCredentials(args.userId);
    const modules = await listCanvasCourseModules(
      credentials,
      args.canvasCourseId,
      args.fetchImpl ?? fetch,
    );
    for (const candidate of extractCanvasModuleCandidates(modules, materialIdByCanvasFileId)) {
      for (const materialId of candidate.materialIds) {
        byMaterial.set(materialId, [...(byMaterial.get(materialId) ?? []), candidate.name]);
      }
    }
  } catch (error) {
    console.error("[topics] Canvas module read failed; continuing without it", error);
  }
  return byMaterial;
}
