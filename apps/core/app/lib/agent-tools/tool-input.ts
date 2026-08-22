/**
 * A JSON value exactly as the model emits it.
 *
 * Tool arguments cross an untyped boundary: the model is free to send a field
 * with the wrong type, or to omit a required one, and the entry point's job is
 * to reject that. So the contract here is "some JSON", not the parsed domain
 * shape — every entry point runs its owning schema before touching the domain,
 * and typing the parameter as the parsed shape would make that parse dead on
 * paper and its rejection tests uncompilable.
 */
export type ToolInputValue =
  | string
  | number
  | boolean
  | null
  | ToolInputValue[]
  | { [key: string]: ToolInputValue };

/**
 * The argument object a chat tool hands an entry point, before it is parsed.
 * Values admit `undefined` because a tool's optional arguments arrive as
 * `string | undefined` from its zod parameter type, which is how an omitted
 * key is spelled on the TypeScript side of a JSON payload.
 */
export type ToolInput = { [key: string]: ToolInputValue | undefined };
