import { PrismaClient } from "@prisma/client";

declare global {
  var __prisma: PrismaClient | undefined;
  var __prismaConnectStarted: boolean | undefined;
}

const prisma = globalThis.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalThis.__prisma = prisma;

// Eagerly open the connection pool at module load so the first request does
// not pay the ~100-500 ms cold connect cost. Guarded by a global flag so HMR
// reloads in dev do not stack multiple connect attempts.
if (!globalThis.__prismaConnectStarted && process.env.NODE_ENV !== "test") {
  globalThis.__prismaConnectStarted = true;
  prisma.$connect().catch((error) => {
    console.error("Prisma initial $connect() failed:", error);
  });
}

export default prisma;


