-- Whether Core's learner view includes this topic (#1956). Fails closed: rows stay
-- hidden from students until the next sync from Core marks them.
ALTER TABLE "public"."Topic" ADD COLUMN "learnerVisible" BOOLEAN NOT NULL DEFAULT false;
