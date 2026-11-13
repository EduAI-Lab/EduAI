-- #2127 review: the first backfill (20261104120000) only recovered users who
-- still held a session, so anyone who had signed out read as "never signed in".
-- Successful password sign-ins are also in the audit log (LOGIN_SUCCESS, since
-- June 2026), so take the latest of those too. The actor id is null when the
-- sign-in route couldn't read the new session; the email is still recorded as
-- the entity label, so match on that instead.
UPDATE "user" u
SET "lastSignInAt" = a.latest
FROM (
  SELECT COALESCE(al."actorUserId", by_email.id) AS "userId", MAX(al."createdAt") AS latest
  FROM "audit_logs" al
  LEFT JOIN "user" by_email
    ON al."actorUserId" IS NULL AND lower(by_email.email) = lower(al."entityLabel")
  WHERE al."actionCode" = 'LOGIN_SUCCESS' AND al."outcome" = 'SUCCESS'
  GROUP BY 1
) a
WHERE a."userId" = u.id
  AND (u."lastSignInAt" IS NULL OR u."lastSignInAt" < a.latest);
