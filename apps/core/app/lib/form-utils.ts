import { z } from "zod";

// Extract field errors from Zod validation result
export function getFieldErrors<T extends z.ZodRawShape>(
  result: z.SafeParseReturnType<any, any>,
): Record<keyof T, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  if (!result.success) {
    result.error.issues.forEach((issue) => {
      const field = issue.path[0];
      if (field) {
        if (!fieldErrors[field]) {
          fieldErrors[field] = [];
        }
        fieldErrors[field].push(issue.message);
      }
    });
  }

  return fieldErrors as Record<keyof T, string[]>;
}

// Get the first error message for a specific field
export function getFieldError<T extends z.ZodRawShape>(
  fieldErrors: Record<keyof T, string[]>,
  fieldName: keyof T,
): string | undefined {
  const errors = fieldErrors[fieldName];
  return errors && errors.length > 0 ? errors[0] : undefined;
}

// Format all errors as a single string
export function getFormErrorMessage<T extends z.ZodRawShape>(
  result: z.SafeParseReturnType<any, any>,
): string {
  if (result.success) return "";

  const errors = result.error.issues.map((issue) => issue.message);
  return errors.join(", ");
}

// Validate a single field (useful for real-time validation)
export function validateField<T extends z.ZodSchema>(
  schema: T,
  value: unknown,
): { isValid: boolean; error?: string } {
  const result = schema.safeParse(value);

  if (result.success) {
    return { isValid: true };
  }

  return {
    isValid: false,
    error: result.error.issues[0]?.message || "Invalid input",
  };
}