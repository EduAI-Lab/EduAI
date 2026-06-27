import { lazy, type ComponentProps } from "react";

type StreamdownProps = ComponentProps<
  typeof import("streamdown").Streamdown
>;

/**
 * Streamdown + Shiki code + KaTeX math plugins, loaded only on the client.
 * @streamdown/code and @streamdown/math are ESM-only; static imports break
 * react-router-serve in Docker (CommonJS, no apps/core/package.json in the serve image).
 */
export const LazyStreamdown = lazy(() =>
  Promise.all([
    import("streamdown"),
    import("@streamdown/code"),
    import("@streamdown/math"),
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
  }),
);
