import { z } from "zod";

/**
 * Async AI-job payload schema — Zod is the source of truth (matches the
 * convention in `app/lib/ai/schemas.ts`); the TS type is derived via `z.infer`.
 *
 * Frozen contract: docs/implementations/async-ai-job-queue-contract.md §3.
 * `input` is a discriminated union on `kind` so each work-kind carries exactly
 * its own fields.
 */

// Concrete async work kinds. Seeded with the only v1 producer; extend as producers land.
export const JobKindSchema = z.enum(["question-generation"]);
export type JobKind = z.infer<typeof JobKindSchema>;

// Reused from the fleet (contract §2). Fleet does not export a runtime schema yet,
// so it is declared here; keep in sync with the `AiJobType` Prisma enum.
// TODO(#168): import from `app/lib/ai/routing/fleet/types.ts` once it lands.
export const JobTypeSchema = z.enum(["interactive", "background"]);
export type JobType = z.infer<typeof JobTypeSchema>;

// Kind-specific inputs (discriminated on `kind`).
const QuestionGenerationInputSchema = z.object({
  kind: z.literal("question-generation"),
  courseId: z.string().min(1),
  prompt: z.string().min(1),
  count: z.number().int().min(1).max(100),
});

export const JobInputSchema = z.discriminatedUnion("kind", [
  QuestionGenerationInputSchema,
  // future kinds add their schema here
]);

export const JobPayloadSchema = z
  .object({
    kind: JobKindSchema, // concrete work kind; also the BullMQ job name
    type: JobTypeSchema, // fleet pool selector + priority (§2)
    source: z.string().min(1), // origin app — telemetry only, free-form
    userId: z.string().min(1), // owner; RBAC + result routing
    courseId: z.string().min(1).optional(), // course scope where applicable
    input: JobInputSchema, // kind-specific payload
    requestedModel: z.string().optional(), // explicit model id; else Auto routing decides
    idempotencyKey: z.string().optional(), // dedupe retried enqueues
  })
  // `input.kind` MUST equal the top-level `kind` (contract §3).
  .refine((job) => job.input.kind === job.kind, {
    message: "input.kind must equal the top-level kind",
    path: ["input", "kind"],
  });

export type JobPayload = z.infer<typeof JobPayloadSchema>;
