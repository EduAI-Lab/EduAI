import { PrismaClient } from "@prisma/client";

declare global {
  var __prisma: PrismaClient | undefined;
}

/** Dev hot-reload can keep an old client after `prisma generate`; refresh when delegates are missing. */
function getPrismaClient(): PrismaClient {
  const cached = globalThis.__prisma;
  if (cached && "courseReEmbedJob" in cached) {
    return cached;
  }

  const client = new PrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalThis.__prisma = client;
  }
  return client;
}

const prisma = getPrismaClient();

export default prisma;


