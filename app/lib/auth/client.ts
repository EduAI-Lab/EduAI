import { apiKeyClient } from "@better-auth/api-key/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields({
      user: {
        role: {
          type: "string",
          defaultValue: "STUDENT",
          required: false,
          returned: true,
        },
        isActive: {
          type: "boolean",
          defaultValue: true,
          required: false,
          returned: true,
        },
      },
    }),
    apiKeyClient(),
    oauthProviderClient(),
  ],
  baseURL: typeof window !== "undefined" ? window.location.origin : undefined,
});

// Export convenience methods
export const {
  signIn,
  signUp,
  signOut,
  useSession,
  getSession,
  updateUser,
  changePassword,
  changeEmail,
} = authClient;
