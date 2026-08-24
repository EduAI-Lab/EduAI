import type { JsonObject, JsonValue } from "~/lib/json-value";

/**
 * A tool argument value exactly as the model emits it.
 *
 * Tool arguments cross an untyped boundary: the model is free to send a field
 * with the wrong type, or to omit a required one, and the entry point's job is
 * to reject that. So the contract here is "some JSON", not the parsed domain
 * shape — every entry point runs its owning schema before touching the domain,
 * and typing the parameter as the parsed shape would make that parse dead on
 * paper and its rejection tests uncompilable.
 */
export type ToolInputValue = JsonValue;

/** The argument object a chat tool hands an entry point, before it is parsed. */
export type ToolInput = JsonObject;
