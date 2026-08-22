import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const courseDuplicates = await prisma.$queryRawUnsafe(`
    SELECT "externalSource", "externalId", array_agg(id ORDER BY "createdAt") AS course_ids
    FROM "courses"
    WHERE "externalSource" IS NOT NULL AND "externalId" IS NOT NULL
    GROUP BY "externalSource", "externalId"
    HAVING COUNT(*) > 1
  `);
  const reEmbedDuplicates = await prisma.$queryRawUnsafe(`
    SELECT "courseId", array_agg(id ORDER BY "createdAt") AS job_ids
    FROM "course_re_embed_jobs"
    WHERE status IN ('PENDING', 'RUNNING')
    GROUP BY "courseId"
    HAVING COUNT(*) > 1
  `);

  if (courseDuplicates.length || reEmbedDuplicates.length) {
    if (courseDuplicates.length) console.table(courseDuplicates);
    if (reEmbedDuplicates.length) console.table(reEmbedDuplicates);
    throw new Error(
      "Resolve duplicate course identities and active re-embed jobs before migrating",
    );
  }

  const apiKeyMigration = await prisma.$queryRawUnsafe(`
    SELECT 1
    FROM "_prisma_migrations"
    WHERE migration_name = '20260811120000_better_auth_api_key_contract'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
    LIMIT 1
  `);
  if (apiKeyMigration.length) {
    console.log("Migration preflight passed; the API-key contract migration is already applied.");
    return;
  }

  const expiringKeys = await prisma.$queryRawUnsafe(`
    SELECT k.id, k.name, u.email AS owner_email, k."createdAt",
           LEAST(
             COALESCE(k."expiresAt", k."createdAt" + INTERVAL '365 days'),
             k."createdAt" + INTERVAL '365 days'
           ) AS migration_expiry
    FROM "apiKey" k
    LEFT JOIN "user" u ON u.id = k."userId"
    WHERE (
      k."rateLimitEnabled" = false
      OR k."rateLimitTimeWindow" IS NULL
      OR k."rateLimitMax" IS NULL
      OR k."expiresAt" IS NULL
    )
      AND LEAST(
        COALESCE(k."expiresAt", k."createdAt" + INTERVAL '365 days'),
        k."createdAt" + INTERVAL '365 days'
      ) <= NOW()
    ORDER BY owner_email, k.name
  `);

  if (expiringKeys.length) {
    console.table(expiringKeys);
    if (process.env.EDUAI_ACK_API_KEY_ROTATION !== "1") {
      throw new Error(
        "The migration will expire the API keys listed above. Notify their owners, rotate the keys, then rerun with EDUAI_ACK_API_KEY_ROTATION=1.",
      );
    }
  }
  console.log("Migration preflight passed.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
