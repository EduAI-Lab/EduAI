/**
 * @file Stamps `user.lastSignInAt`, which feeds the admin dashboard's
 * "Accounts that never signed in". Every sign-in path (email, invitation
 * acceptance, dev quick login) creates a session through better-auth, so the
 * session-create hook below covers them all.
 */
import prisma from "../prisma.server";
import { redactErrorForConsole } from "../redact.server";

/**
 * Raw SQL rather than `prisma.user.update`, so a sign-in doesn't bump the
 * row's `@updatedAt` (Prisma sets that client-side on every update). A failed
 * stamp is logged, not thrown: it must never block the sign-in itself.
 */
export async function stampLastSignIn(userId: string, now: Date = new Date()): Promise<void> {
  try {
    await prisma.$executeRaw`UPDATE "user" SET "lastSignInAt" = ${now} WHERE "id" = ${userId}`;
  } catch (error) {
    console.error("[LAST_SIGN_IN_STAMP_FAILED]", { userId, error: redactErrorForConsole(error) });
  }
}

/** better-auth `databaseHooks.session`: stamp the user on every new session. */
export const lastSignInSessionHooks = {
  create: {
    after: async (session: { userId: string }) => {
      await stampLastSignIn(session.userId);
    },
  },
};
