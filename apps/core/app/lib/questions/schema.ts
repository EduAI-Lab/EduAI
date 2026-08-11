import { z } from "zod";

export const MAX_CREATE_QUESTION_BODY_BYTES = 64 * 1024;

const CreateQuestionSchema = z
  .object({
    courseId: z.string().min(1).max(191),
    topicId: z.string().min(1).max(191),
    content: z.string().min(1).max(20_000),
    type: z.enum(["MCQ", "SA", "LA"]),
    difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).optional(),
    reasoningLevel: z.enum(["FACTUAL", "ANALYTICAL", "APPLICATION"]).optional(),
    choices: z
      .array(
        z.object({
          letter: z.string().min(1).max(16),
          text: z.string().min(1).max(20_000),
        }).strict(),
      )
      .max(20)
      .optional(),
    answer: z.string().max(20_000).optional(),
    testable: z.boolean().optional(),
    secondaryTopicIds: z.array(z.string().min(1).max(191)).max(50).optional(),
    // Retained for the established body-key idempotency contract. Persistence
    // receives the parsed shape below with this transport-only field removed.
    idempotencyKey: z.string().min(1).max(191).optional(),
  })
  .strict();

export type CreateQuestionInput = z.infer<typeof CreateQuestionSchema>;
export type ValidatedCreateQuestion = Omit<CreateQuestionInput, "idempotencyKey">;

export type CreateQuestionValidation =
  | { success: true; data: ValidatedCreateQuestion }
  | { success: false; error: { error: "VALIDATION_ERROR"; fields: Record<string, string> } };

export function validateCreateQuestion(body: unknown): CreateQuestionValidation {
  const parsed = CreateQuestionSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const fields: Record<string, string> = {};
    for (const [key, messages] of Object.entries(fieldErrors)) {
      if (messages && messages.length > 0) fields[key] = messages[0];
    }
    if (parsed.error.issues.some((issue) => issue.code === "unrecognized_keys")) {
      fields.body = "Unrecognized field(s) in request body";
    }
    return { success: false, error: { error: "VALIDATION_ERROR", fields } };
  }

  const { idempotencyKey: _idempotencyKey, ...data } = parsed.data;
  return { success: true, data };
}
