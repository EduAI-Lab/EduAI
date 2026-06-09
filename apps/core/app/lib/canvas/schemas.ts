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
