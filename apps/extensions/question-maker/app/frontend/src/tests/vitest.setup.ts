import * as matchers from "@testing-library/jest-dom/matchers";
import { expect } from "vitest";

expect.extend(matchers);

// jsdom doesn't implement layout, so `Element.scrollIntoView` is missing —
// several pages call it (e.g. scrolling a form's first invalid field into
// view) which otherwise throws a TypeError / unhandled rejection in tests.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
