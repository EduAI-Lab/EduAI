import { apiKeyClient } from "@better-auth/api-key/client";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { isBrowser } from "@eduai/ui/runtime-env";

export const authClient = createAuthClient({
  plugins: [
    apiKeyClient(),
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
  ],
  baseURL: isBrowser() ? window.location.origin : undefined,
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
