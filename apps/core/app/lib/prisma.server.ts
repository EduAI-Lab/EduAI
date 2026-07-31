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

// Warm the connection pool at module load so the first request after boot does
// not pay Prisma's lazy connect (TCP/TLS handshake + query-engine spawn) — that
// cold start was the multi-second stall on the first navigation. Fire-and-forget:
// queries still connect lazily if this races, so a failure here is non-fatal.
if (process.env.PRISMA_SKIP_EAGER_CONNECT !== "1") {
  void prisma.$connect().catch((err) => {
    console.error("[prisma] initial $connect failed (will retry lazily)", err);
  });
}

export default prisma;

