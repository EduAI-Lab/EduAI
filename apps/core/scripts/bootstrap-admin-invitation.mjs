import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

const prisma = new PrismaClient();

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const email = requiredEnv("CORE_BOOTSTRAP_ADMIN_EMAIL").toLowerCase();
  const authBaseUrl = new URL(requiredEnv("BETTER_AUTH_URL"));
  if (!email.includes("@")) throw new Error("CORE_BOOTSTRAP_ADMIN_EMAIL must be an email address");

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext('eduai:first-admin-bootstrap'))",
    );
    const [adminCount, existingUser, pendingAdminInvite] = await Promise.all([
      tx.user.count({ where: { role: "ADMIN" } }),
      tx.user.findUnique({ where: { email }, select: { id: true } }),
      tx.invitation.findFirst({
        where: { role: "ADMIN", status: "PENDING" },
        select: { id: true },
      }),
    ]);
    if (adminCount > 0) throw new Error("Bootstrap refused: an ADMIN account already exists");
    if (existingUser) throw new Error("Bootstrap refused: that email already has an account");
    if (pendingAdminInvite)
      throw new Error("Bootstrap refused: a pending ADMIN invitation already exists");

    await tx.invitation.create({
      data: {
        email,
        name: process.env.CORE_BOOTSTRAP_ADMIN_NAME?.trim() || null,
        role: "ADMIN",
        tokenHash,
        invitedById: null,
        expiresAt,
      },
    });
  });

  authBaseUrl.pathname = "/auth/accept-invitation";
  authBaseUrl.search = new URLSearchParams({ token }).toString();
  console.log(`First-admin invitation created; expires ${expiresAt.toISOString()}`);
  console.log(authBaseUrl.toString());
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
