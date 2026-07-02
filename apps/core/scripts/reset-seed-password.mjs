import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npx tsx scripts/reset-seed-password.mjs <email>");
  process.exit(1);
}

const seedSource = readFileSync(new URL("../prisma/seed.ts", import.meta.url), "utf8");
const match = seedSource.match(/const SEED_PASSWORD = '([^']+)'/);
if (!match) {
  throw new Error("Could not read SEED_PASSWORD from prisma/seed.ts");
}

const prisma = new PrismaClient();
try {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }

  const hashed = await hashPassword(match[1]);
  await prisma.account.upsert({
    where: { providerId_accountId: { providerId: "credential", accountId: email } },
    update: { password: hashed },
    create: {
      providerId: "credential",
      accountId: email,
      userId: user.id,
      password: hashed,
    },
  });

  console.log(`Password reset for ${user.email} (${user.name}) using SEED_PASSWORD from prisma/seed.ts`);
} finally {
  await prisma.$disconnect();
}
