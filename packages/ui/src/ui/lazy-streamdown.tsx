import { lazy, type ComponentProps } from "react";

type StreamdownProps = ComponentProps<
  typeof import("streamdown").Streamdown
>;

/**
 * Streamdown + Shiki code plugin, loaded only on the client.
 * @streamdown/code is ESM-only; a static import breaks react-router-serve in Docker
 * (CommonJS, no apps/core/package.json in the serve image).
 */
export const LazyStreamdown = lazy(() =>
  Promise.all([import("streamdown"), import("@streamdown/code")]).then(
    ([streamdown, codeMod]) => {
      const plugins = { code: codeMod.code };
      const { Streamdown } = streamdown;
      return {
        default: (props: StreamdownProps) => (
          <Streamdown {...props} plugins={plugins} />
        ),
      };
    },
  ),
);
