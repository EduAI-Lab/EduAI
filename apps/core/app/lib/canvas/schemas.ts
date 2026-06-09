import { z } from "zod";

function normalizeCanvasUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export const ConnectCanvasSchema = z
  .object({
    canvasUrl: z
      .string()
      .min(1, "Canvas URL is required")
      .url("Invalid Canvas URL format")
      .transform(normalizeCanvasUrl),
    apiKey: z.string().optional(),
    isTestMode: z.boolean().optional().default(false),
  })
  .refine((data) => data.isTestMode || (data.apiKey != null && data.apiKey.length > 0), {
    message: "API key is required unless using test mode",
    path: ["apiKey"],
  });

export type ConnectCanvasInput = z.infer<typeof ConnectCanvasSchema>;

export type CanvasIntegrationPublic = {
  canvasUrl: string;
  isTestMode: boolean;
  isConnected: true;
};

export const SyncCanvasCoursesSchema = z.object({
  canvasCourseIds: z.array(z.coerce.string().min(1)).min(0),
});

export type SyncCanvasCoursesInput = z.infer<typeof SyncCanvasCoursesSchema>;

export type CanvasCoursePickerItem = {
  canvasId: string;
  name: string;
  courseCode: string;
  isSynced: boolean;
  coreCourseId: string | null;
  lastSyncedAt: string | null;
};

export type SyncCanvasCourseResult = {
  canvasId: string;
  coreCourseId: string;
  rosterMembersSynced: number;
  enrollmentsLinked: number;
};

export type UnsyncCanvasCourseResult = {
  canvasId: string;
  coreCourseId: string;
};

export type SyncCanvasCoursesResult = {
  synced: SyncCanvasCourseResult[];
  unsynced: UnsyncCanvasCourseResult[];
  errors: Array<{ canvasId: string; message: string }>;
};

export const LinkRosterSchema = z.object({
  studentNumber: z
    .string()
    .min(1, "Student number is required")
    .max(32, "Student number is too long")
    .transform((value) => value.trim()),
});

export type LinkRosterInput = z.infer<typeof LinkRosterSchema>;

export type LinkRosterResponse = {
  studentId: string;
  enrollmentsLinked: number;
};
