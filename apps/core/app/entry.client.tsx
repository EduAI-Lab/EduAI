import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { NonceProvider, readDocumentNonce } from "~/lib/nonce";

// React Router's client framework context does not retain the nonce passed to
// ServerRouter. Read the nonce from the already-rendered SSR script before
// hydration so root Links/theme/ScrollRestoration/Scripts produce the exact
// same attributes as the server. This value lives only in React context.
const nonce = readDocumentNonce();

startTransition(() => {
  hydrateRoot(
    document,
    <NonceProvider value={nonce}>
      <StrictMode>
        <HydratedRouter />
      </StrictMode>
    </NonceProvider>,
  );
});
