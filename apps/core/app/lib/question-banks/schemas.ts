import { z } from "zod";

export const CreateQuestionBankSchema = z.object({
  name: z.string().trim().min(1, "Bank name is required"),
  description: z.string().nullable().optional(),
});

export const UpdateQuestionBankSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().nullable().optional(),
});

export const DeleteQuestionBankSchema = z.object({
  moveMembershipsToBankId: z.string().min(1).optional(),
});

export const AddBankMembershipSchema = z.object({
  externalQuestionId: z.string().min(1),
  source: z.string().min(1).optional().default("question-maker"),
});

export const AddBankMembershipsSchema = z.object({
  memberships: z.array(AddBankMembershipSchema).min(1).max(500),
});

export type CreateQuestionBankInput = z.infer<typeof CreateQuestionBankSchema>;
export type UpdateQuestionBankInput = z.infer<typeof UpdateQuestionBankSchema>;
export type DeleteQuestionBankInput = z.infer<typeof DeleteQuestionBankSchema>;
export type AddBankMembershipInput = z.infer<typeof AddBankMembershipSchema>;
export type AddBankMembershipsInput = z.infer<typeof AddBankMembershipsSchema>;
