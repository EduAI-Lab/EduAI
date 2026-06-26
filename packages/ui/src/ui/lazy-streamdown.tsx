import { lazy, type ComponentProps } from "react";

type StreamdownProps = ComponentProps<
  typeof import("streamdown").Streamdown
>;

/**
 * Streamdown + KaTeX math plugins, loaded only on the client.
 * @streamdown/math is ESM-only; a static import breaks react-router-serve in Docker
 * (CommonJS, no apps/core/package.json in the serve image).
 */
export const LazyStreamdown = lazy(() =>
  Promise.all([import("streamdown"), import("@streamdown/math")]).then(
    ([streamdown, mathMod]) => {
      const plugins = {
        math: mathMod.createMathPlugin(),
      };
      const { Streamdown } = streamdown;
      return {
        default: (props: StreamdownProps) => (
          <Streamdown {...props} plugins={plugins} />
        ),
      };
    },
  ),
);
