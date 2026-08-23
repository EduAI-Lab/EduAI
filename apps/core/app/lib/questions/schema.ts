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
        z
          .object({
            letter: z.string().min(1).max(16),
            text: z.string().min(1).max(20_000),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    answer: z.string().max(20_000).optional(),
    selectAllThatApply: z.boolean().optional(),
    correctAnswers: z.array(z.string().min(1).max(16)).max(20).nullable().optional(),
    testable: z.boolean().optional(),
    secondaryTopicIds: z.array(z.string().min(1).max(191)).max(50).optional(),
    // Retained for the established body-key idempotency contract. Persistence
    // receives the parsed shape below with this transport-only field removed.
    idempotencyKey: z.string().min(1).max(191).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const answers = data.correctAnswers;
    if (data.selectAllThatApply !== true) {
      if (answers != null && answers.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "correctAnswers is only allowed when selectAllThatApply is true",
          path: ["correctAnswers"],
        });
      }
      return;
    }
    if (data.type !== "MCQ") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "selectAllThatApply is only valid for MCQ questions",
        path: ["selectAllThatApply"],
      });
    }
    if (!answers?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "selectAllThatApply requires at least one correctAnswers entry",
        path: ["correctAnswers"],
      });
      return;
    }
    const choiceLetters = new Set(
      (data.choices ?? []).map((choice) => choice.letter.trim().toUpperCase()),
    );
    for (const raw of answers) {
      const letter = raw.trim().toUpperCase();
      if (!/^[A-Z]$/.test(letter) || !choiceLetters.has(letter)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Correct answer ${letter} is not in choices`,
          path: ["correctAnswers"],
        });
        return;
      }
    }
  })
  .transform((data) => {
    if (data.selectAllThatApply !== true) {
      return { ...data, selectAllThatApply: false, correctAnswers: null };
    }
    const correctAnswers = [
      ...new Set((data.correctAnswers ?? []).map((answer) => answer.trim().toUpperCase())),
    ].sort();
    return {
      ...data,
      selectAllThatApply: true,
      correctAnswers,
      answer: correctAnswers[0],
    };
  });

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
