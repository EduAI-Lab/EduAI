import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { scrollToSection } from "~/lib/scroll-to-section";

/**
 * `scrollToSection` exists to work around a ScrollRestoration race (see the
 * doc comment on the helper), so the behaviour it encodes — preventing the
 * native anchor jump, honouring reduced motion, and preserving React Router's
 * `history.state` — is what these tests pin.
 */
function clickEvent() {
  return { preventDefault: vi.fn() };
}

function scrollSpy() {
  return vi.fn((_options?: boolean | ScrollIntoViewOptions) => {});
}

function stubMatchMedia(matches: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
    const list = new EventTarget() as MediaQueryList;
    Object.assign(list, {
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    });
    return list;
  });
}

describe("scrollToSection", () => {
  let scrollIntoView: ReturnType<typeof scrollSpy>;

  beforeEach(() => {
    scrollIntoView = scrollSpy();
    const section = document.createElement("section");
    section.id = "research";
    section.scrollIntoView = scrollIntoView;
    document.body.appendChild(section);
    stubMatchMedia(false);
    history.replaceState(null, "", "/");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-reduce-motion");
    vi.restoreAllMocks();
  });

  it("scrolls the target and suppresses the browser's own anchor jump", () => {
    const event = clickEvent();
    scrollToSection(event, "#research");

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("leaves non-hash hrefs to the router", () => {
    const event = clickEvent();
    scrollToSection(event, "/login");

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("falls back to the native jump when the section is missing", () => {
    const event = clickEvent();
    scrollToSection(event, "#nope");

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("drops the smooth animation when the OS asks for reduced motion", () => {
    stubMatchMedia(true);
    scrollToSection(clickEvent(), "#research");

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it("drops the smooth animation for the account-level preference", () => {
    document.documentElement.setAttribute("data-reduce-motion", "true");
    scrollToSection(clickEvent(), "#research");

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it("preserves React Router's history state instead of nulling it", () => {
    // A null state makes RR's getIndex() return null, so the next push computes
    // `null + 1` and the entry key falls back to "default".
    const routerState = { usr: null, key: "abc123", idx: 4 };
    history.replaceState(routerState, "", "/");

    scrollToSection(clickEvent(), "#research");

    expect(history.state).toEqual(routerState);
    expect(window.location.hash).toBe("#research");
  });
});
