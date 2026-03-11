import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import type { LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";

const handler = oauthProviderAuthServerMetadata(auth);

export async function loader({ request }: LoaderFunctionArgs) {
  return handler(request);
}
