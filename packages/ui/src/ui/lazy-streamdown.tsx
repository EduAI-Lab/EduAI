import { lazy, type ComponentType, type ComponentProps } from "react";

type StreamdownProps = ComponentProps<
  typeof import("streamdown").Streamdown
>;

/**
 * Loads an app-owned stylesheet, e.g. `() => import("katex/dist/katex.min.css")`.
 *
 * The apps supply these rather than `packages/ui` importing the vendor CSS
 * itself: `katex` is deliberately not a dependency here (streamdown and friends
 * are peers), and each app owns which of its chunks the sheet lands in.
 */
export type MarkdownStyleLoader = () => Promise<unknown>;

function loadStreamdown(loadKatexStyles?: MarkdownStyleLoader) {
  return Promise.all([
    import("streamdown"),
    import("@streamdown/code"),
    import("@streamdown/math"),
    // Resolved as part of the same suspended promise as Streamdown itself, so
    // math cannot paint before its stylesheet lands — a detached import() after
    // render would flash unstyled math (#1342). Failures are swallowed: a
    // missing stylesheet should degrade to unstyled math, not suspend the
    // message forever (React.lazy caches rejections permanently).
    loadKatexStyles && typeof document !== "undefined"
      ? loadKatexStyles().catch(() => undefined)
      : undefined,
  ]).then(([streamdown, codeMod, mathMod]) => {
    const plugins = {
      code: codeMod.code,
      math: mathMod.createMathPlugin(),
    };
    const { Streamdown } = streamdown;
    return {
      default: (props: StreamdownProps) => (
        <Streamdown {...props} plugins={plugins} />
      ),
    };
  });
}

/**
 * Streamdown + Shiki code + KaTeX math plugins, loaded only on the client.
 * @streamdown/code and @streamdown/math are ESM-only; static imports break
 * react-router-serve in Docker (CommonJS, no apps/core/package.json in the serve image).
 */
export const LazyStreamdown = lazy(() => loadStreamdown());

const mathVariants = new WeakMap<
  MarkdownStyleLoader,
  ComponentType<StreamdownProps>
>();

/**
 * Variant of {@link LazyStreamdown} that also resolves the KaTeX stylesheet.
 *
 * Cached per loader identity so the returned component stays stable across
 * renders — a fresh `lazy()` on every render would remount the block and
 * re-suspend. Callers must therefore pass a module-level loader function, not
 * an inline arrow; `MarkdownStylesProvider` documents the same requirement.
 */
export function getMathStreamdown(
  loadKatexStyles?: MarkdownStyleLoader,
): ComponentType<StreamdownProps> {
  if (!loadKatexStyles) return LazyStreamdown;

  let variant = mathVariants.get(loadKatexStyles);
  if (!variant) {
    variant = lazy(() => loadStreamdown(loadKatexStyles));
    mathVariants.set(loadKatexStyles, variant);
  }
  return variant;
}
