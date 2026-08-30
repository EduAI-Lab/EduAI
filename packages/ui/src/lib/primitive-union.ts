/**
 * Telling apart the arms of a union that differ only by primitive type.
 *
 * React component props are full of these: `string | ReactNode` for a label
 * that may already be markup, `number | string` for a CSS length, `unknown` for
 * a captured request body. There is no tag to read and no payload to decode —
 * the primitive type *is* the discriminator the union offers, and the value is
 * already inside the process rather than arriving from an I/O boundary.
 *
 * `packages/ui` also carries no zod: it is the browser bundle shared by all
 * three apps and is kept dependency-light. So these are the standing
 * `anti-slop/no-runtime-typeof` exemption for this package — named once and
 * suppressed once here, rather than repeated at every component that renders a
 * label (#1599).
 *
 * Prefer `instanceof` where it works: `value instanceof Function` and
 * `value instanceof Object` need no exemption and are used directly at the call
 * sites that can.
 */

/** The string arm of a union, narrowed. */
export function isString<T>(value: string | T): value is string {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof
  return typeof value === "string";
}

/** The number arm of a union, narrowed. */
export function isNumber<T>(value: number | T): value is number {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof
  return typeof value === "number";
}
