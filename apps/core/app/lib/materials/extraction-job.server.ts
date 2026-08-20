/**
 * Durable background extraction for material uploads (#949).
 *
 * The upload request persists the row *and its raw bytes* and returns 202; every
 * expensive step — extraction, duplicate resolution, embedding — happens here,
 * off the request. Two pieces make that recoverable rather than merely deferred:
 *
 *   - **The bytes outlive the request.** `MaterialUploadBlob` is written in the
 *     same transaction as the `CourseMaterial` row, so a material that is
 *     PROCESSING always has something to re-run against. It is deleted the
 *     moment the row reaches a terminal state, so the table only ever holds
 *     in-flight uploads.
 *   - **A worker must hold a lease.** `extractionLeaseUntil` is what separates a
 *     live run from a dead one: a PROCESSING row whose lease has expired is by
 *     definition abandoned — the process holding it died — and the sweeper
 *     re-claims it and resumes from the persisted bytes. `extractionAttempts`
 *     bounds that loop so a file that reliably kills its worker fails
 *     terminally instead of being retried forever.
 *
 * Claims are conditional `updateMany`s, never read-then-write: the predicate
 * lives in the UPDATE's WHERE so the database serializes two workers racing for
 * the same row and exactly one proceeds.
 */
import prisma from "~/lib/prisma.server";
import { processMaterialEmbeddings } from "~/lib/ai/embedding";
import { extractUploadedFileContent } from "~/lib/ai/file-processing";
import { fireAndForget, logSystemError } from "~/lib/logging.server";
import type { getRequestContext } from "~/lib/request-context.server";

type RequestContext = ReturnType<typeof getRequestContext>;

/**
 * Provisional checksum namespace for a row whose content hash is not known yet.
 * Distinct from the Canvas importer's `canvas-pending:`, which matters here: the
 * sweeper only ever touches direct uploads, and the prefix is how it tells them
 * apart from Canvas rows that are PROCESSING for entirely different reasons.
 */
export const PENDING_CHECKSUM_PREFIX = "pending:";

/**
 * How long a claimed extraction may run before the sweeper treats it as dead.
 * Sized well above the worst legitimate run (the PDF worker's own timeout plus
 * embedding round trips) — the cost of a too-short lease is two workers on one
 * row, which the conditional claim prevents but which still wastes a run.
 */
export const EXTRACTION_LEASE_MS = 15 * 60 * 1000;

/** Give up after this many attempts and fail the row terminally. */
export const MAX_EXTRACTION_ATTEMPTS = 3;

/** How often the in-process sweeper looks for abandoned rows. */
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Cap per sweep so one pass cannot pull an unbounded backlog into memory. */
export const SWEEP_BATCH_SIZE = 20;

/**
 * Move a material to terminal FAILED and record why. The row is the
 * client-visible signal; `logSystemError` is the operator one.
 */
export async function failMaterial(
  materialId: string,
  code: "MATERIAL_EXTRACT_FAILED" | "MATERIAL_EMBED_FAILED" | "MATERIAL_EXTRACT_ABANDONED",
  message: string,
  error: unknown,
  requestContext: RequestContext,
): Promise<void> {
  console.error(`${code}:`, error);
  try {
    await prisma.courseMaterial.update({
      where: { id: materialId },
      data: { status: "FAILED", extractionLeaseUntil: null },
    });
  } catch (updateError) {
    console.error("Additionally failed to mark material FAILED:", updateError);
  }
  await discardUploadBlob(materialId);
  fireAndForget(
    logSystemError({
      ...requestContext,
      source: "AI",
      code,
      message,
      error,
    }),
  );
}

/**
 * Terminal state for an upload whose extracted content turned out to already
 * exist on the course. This is the asynchronous successor to the synchronous
 * 409 the endpoint used to return: the provisional row stays as a receipt so a
 * client polling its `materialId` can resolve the outcome, marked FAILED and
 * pointing at the winner. Clients are expected to read it and then delete it,
 * so duplicate attempts don't accumulate in the materials list.
 */
export async function markDuplicateReceipt(materialId: string, winnerId: string): Promise<void> {
  await prisma.courseMaterial.update({
    where: { id: materialId },
    data: {
      status: "FAILED",
      duplicateOfId: winnerId,
      processedAt: new Date(),
      extractionLeaseUntil: null,
    },
  });
  await discardUploadBlob(materialId);
}

/**
 * Copy into a plain `Uint8Array` for the `Bytes` column. Prisma types it as
 * `Uint8Array<ArrayBuffer>`, which a Node `Buffer` does not satisfy — its
 * backing store may be a `SharedArrayBuffer`.
 */
export function toBytesColumn(bytes: Buffer | Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

/**
 * Persist the uploaded bytes against a material row. Called inside the same
 * transaction that creates (or reclaims) the row, so "row exists in PROCESSING"
 * and "bytes exist to retry from" are never observable apart.
 *
 * Upsert rather than create: reclaiming a stranded row re-uploads the same file,
 * and the new bytes must replace whatever the dead attempt left behind.
 *
 * `client` takes a transaction client so the reclaim path can flip the row to
 * PROCESSING and replace its bytes in one commit (#1494 review). Split across
 * two statements, a failure in between leaves a pending row with no blob: the
 * sweeper skips it for want of bytes and identical retries answer 409, so it is
 * stranded permanently.
 */
export async function persistUploadBlob(
  materialId: string,
  bytes: Buffer | Uint8Array,
  fileName: string,
  mimeType: string,
  client: Pick<typeof prisma, "materialUploadBlob"> = prisma,
): Promise<void> {
  // Prisma's Bytes maps to `Uint8Array<ArrayBuffer>`; a Node Buffer can be backed
  // by a SharedArrayBuffer, so normalize rather than cast.
  const payload = { bytes: toBytesColumn(bytes), fileName, mimeType };
  await client.materialUploadBlob.upsert({
    where: { materialId },
    create: { materialId, ...payload },
    update: payload,
  });
}

/**
 * Drop the raw upload once it can no longer be needed. Best-effort by design:
 * the material's terminal state is the contract, and a blob left behind by a
 * failed delete is storage to reclaim, not a correctness problem.
 */
async function discardUploadBlob(materialId: string): Promise<void> {
  try {
    await prisma.materialUploadBlob.deleteMany({ where: { materialId } });
  } catch (error) {
    console.error("Failed to discard material upload blob:", error);
  }
}

/**
 * Take the extraction lease for a row, or report that someone else holds it.
 *
 * The whole predicate — still PROCESSING, and either never leased or leased to a
 * worker whose lease has expired — lives in the WHERE, so two workers racing for
 * the same abandoned row serialize on the row lock and exactly one gets
 * `count === 1`.
 */
export async function claimExtraction(materialId: string): Promise<boolean> {
  const now = new Date();
  const claimed = await prisma.courseMaterial.updateMany({
    where: {
      id: materialId,
      status: "PROCESSING",
      OR: [{ extractionLeaseUntil: null }, { extractionLeaseUntil: { lt: now } }],
    },
    data: {
      extractionLeaseUntil: new Date(now.getTime() + EXTRACTION_LEASE_MS),
      extractionAttempts: { increment: 1 },
    },
  });
  return claimed.count === 1;
}

/**
 * Take the restore lease for a soft-deleted duplicate that is coming back
 * (#685), in the same statement that un-deletes it.
 *
 * The restore target keeps its *content* checksum, so the sweeper — which scans
 * `pending:` rows — can never see it directly; recovery reaches it through the
 * receipt instead (see `classifyRestoreTarget`). That only works if a restore in
 * progress is distinguishable from one whose worker died, which is what the
 * lease taken here provides: un-delete and lease are one write, so there is no
 * window in which the target is PROCESSING with nothing claiming it.
 *
 * Reclaiming an already-PROCESSING target requires an *expired* lease, never a
 * null one. `extractionLeaseUntil` is only ever written by this module, so a
 * PROCESSING row that has never been leased belongs to something else — a Canvas
 * import, which sits in PROCESSING for reasons this module knows nothing about —
 * and must not be stomped.
 *
 * `deletedAt != null` is not on its own enough to claim either (#1494 review).
 * DELETE only stamps `deletedAt`; it does not stop the worker already restoring
 * the row. A soft-delete landing mid-restore would otherwise re-open the target
 * to a second claimant, and both workers would embed and finalize the same
 * material. The live lease is checked first for every row, deleted or not, so
 * ownership — never the delete flag — decides who may run.
 */
export async function claimRestoreTarget(
  materialId: string,
  userId: string,
  rawText: string,
): Promise<boolean> {
  const now = new Date();
  const claimed = await prisma.courseMaterial.updateMany({
    where: {
      id: materialId,
      OR: [
        // Settled (READY/FAILED, or any non-PROCESSING state) and soft-deleted:
        // nothing owns it, so this is an ordinary restore.
        { deletedAt: { not: null }, status: { not: "PROCESSING" } },
        // Mid-restore but abandoned: the previous worker's lease has lapsed.
        { status: "PROCESSING", extractionLeaseUntil: { lt: now } },
      ],
    },
    data: {
      deletedAt: null,
      deletedBy: null,
      status: "PROCESSING",
      uploadedBy: userId,
      processedAt: null,
      duplicateOfId: null,
      rawText,
      extractionLeaseUntil: new Date(now.getTime() + EXTRACTION_LEASE_MS),
    },
  });
  return claimed.count === 1;
}

/**
 * What a resumed run should do about the duplicate it just found.
 *
 * A crash mid-restore leaves the target PROCESSING, and the old code read that
 * as "not soft-deleted, therefore settled" and resolved the receipt anyway —
 * stranding the target forever with no recovery path, because the receipt was
 * the only thing that would ever have looked at it (#1494 review).
 *
 *   - `busy` — a live restore holds the lease. Resolving the receipt now would
 *     promise the caller a settled winner that is still mid-flight, so leave the
 *     receipt PROCESSING and let a later sweep see the settled truth. Checked
 *     *before* `deletedAt` (#1494 review): DELETE only stamps the flag, it does
 *     not stop the worker, so a soft-delete landing mid-restore must not make a
 *     live target look claimable.
 *   - `restore` — soft-deleted and settled (a fresh restore), or a restore whose
 *     worker died and whose lease has since expired. Claim it and (re-)run it.
 *   - `settled` — READY, or FAILED, or PROCESSING for reasons unrelated to this
 *     module (an unleased Canvas import). Point the receipt at it, as before.
 */
export function classifyRestoreTarget(
  duplicate: {
    status: string;
    deletedAt: Date | null;
    extractionLeaseUntil: Date | null;
  },
  now: Date = new Date(),
): "restore" | "busy" | "settled" {
  if (duplicate.status === "PROCESSING") {
    // Ownership decides, not `deletedAt`: an unleased PROCESSING row is not
    // ours (a Canvas import), a live lease means someone else is mid-restore,
    // and only a lapsed lease makes it reclaimable.
    if (!duplicate.extractionLeaseUntil) return "settled";
    return duplicate.extractionLeaseUntil < now ? "restore" : "busy";
  }
  return duplicate.deletedAt ? "restore" : "settled";
}

/**
 * Rebuild the `File` the original request handed to the extractor. A resumed run
 * must see byte-for-byte what the first attempt saw, or the content checksum —
 * and therefore duplicate detection — would differ between attempts.
 */
function fileFromBlob(blob: {
  bytes: Buffer | Uint8Array;
  fileName: string;
  mimeType: string;
}): File {
  const view = new Uint8Array(blob.bytes);
  return new File([view], blob.fileName, { type: blob.mimeType });
}

/**
 * Background half of an upload: extract, resolve duplicates against the
 * now-known content checksum, embed, and land the row in READY or FAILED.
 *
 * Assumes the caller already holds the lease (`claimExtraction`). Every exit
 * path is terminal for the row, which is what lets the blob be dropped and the
 * lease cleared on the way out.
 */
export async function runMaterialExtraction(
  materialId: string,
  file: File,
  courseId: string,
  userId: string,
  requestContext: RequestContext,
): Promise<void> {
  let fileInfo;
  try {
    fileInfo = await extractUploadedFileContent(file);
  } catch (extractError) {
    // Unlike the old inline path, the row already exists here, so a killed PDF
    // worker always leaves an auditable record (#1018 / #1161) — there is no
    // longer a window where extraction fails before anything is persisted.
    await failMaterial(
      materialId,
      "MATERIAL_EXTRACT_FAILED",
      "Material extraction failed during background processing",
      extractError,
      requestContext,
    );
    return;
  }

  try {
    // Late duplicate detection, mirroring the Canvas importer's post-extraction
    // check (`lib/canvas/materials.server.ts`). Unlike that one, the P2002 catch
    // below also covers the findFirst-to-update race this check cannot close.
    const duplicate = await prisma.courseMaterial.findFirst({
      where: { courseId, checksum: fileInfo.checksum, id: { not: materialId } },
    });

    if (duplicate) {
      const targetState = classifyRestoreTarget(duplicate);

      if (targetState === "busy") {
        // Another worker is mid-restore. Leave this receipt PROCESSING with its
        // lease running: a sweep after that lease expires re-reads the target
        // and finds it settled, which is the outcome the client should see.
        return;
      }

      if (targetState === "restore") {
        // Restore-on-re-upload (#685) — preserved from the old synchronous path,
        // just deferred: the soft-deleted original comes back and is re-embedded
        // with `replace: true`, and this upload's row becomes its receipt.
        //
        // The un-delete carries its own lease so a crash mid-restore is
        // recoverable rather than terminal; losing the claim means another
        // worker got there first, so leave the receipt for a later sweep.
        if (!(await claimRestoreTarget(duplicate.id, userId, fileInfo.content))) {
          return;
        }
        try {
          // Replace any stale chunks/embeddings from before the soft-delete so
          // restoring a material doesn't append duplicate RAG content (#685 review).
          await processMaterialEmbeddings(duplicate.id, fileInfo.content, {
            replace: true,
          });
          await prisma.courseMaterial.update({
            where: { id: duplicate.id },
            data: { status: "READY", processedAt: new Date(), extractionLeaseUntil: null },
          });
        } catch (embeddingError) {
          await failMaterial(
            duplicate.id,
            "MATERIAL_EMBED_FAILED",
            "Material embedding failed while restoring a soft-deleted material",
            embeddingError,
            requestContext,
          );
        }
        // Receipt LAST, deliberately (#1494 review): marking it before the
        // restored row settles hands the client a terminal "duplicate, nothing
        // was added" outcome while the restored material is still PROCESSING —
        // and the client deletes the receipt on that outcome, so a later
        // restore failure would have nothing left to surface it. Keeping the
        // receipt PROCESSING until restoration lands means a poller either
        // waits or sees the settled truth.
        await markDuplicateReceipt(materialId, duplicate.id);
        return;
      }

      await markDuplicateReceipt(materialId, duplicate.id);
      return;
    }

    // Promote the provisional row: real title/type/size from the extracted
    // metadata, and the content checksum that makes the dedup index meaningful.
    await prisma.courseMaterial.update({
      where: { id: materialId },
      data: {
        title: fileInfo.title,
        mimeType: fileInfo.mimeType,
        fileSize: fileInfo.fileSize,
        checksum: fileInfo.checksum,
        rawText: fileInfo.content,
      },
    });
  } catch (finalizeError) {
    // #225 RAG-04, deferred: two uploads of *different bytes* that extract to
    // identical text both pass the findFirst above and race into this update.
    // The unique index is the real guard; the loser becomes a receipt.
    if (isChecksumConflict(finalizeError)) {
      const winner = await prisma.courseMaterial.findFirst({
        where: { courseId, checksum: fileInfo.checksum, id: { not: materialId } },
        select: { id: true },
      });
      if (winner) {
        await markDuplicateReceipt(materialId, winner.id);
        return;
      }
    }
    await failMaterial(
      materialId,
      "MATERIAL_EXTRACT_FAILED",
      "Material finalization failed during background processing",
      finalizeError,
      requestContext,
    );
    return;
  }

  try {
    // `replace: true` even on the first attempt (#1494 review): the embedding
    // transaction and the READY update below are separate writes, so a crash
    // between them leaves a row that is PROCESSING *and* already embedded. The
    // sweeper resumes it and lands right back here — with `replace: false` that
    // second pass would append a duplicate set of chunks and vectors. Replacing
    // makes the step idempotent, and on a genuine first run it deletes nothing
    // because the row has no chunks yet.
    await processMaterialEmbeddings(materialId, fileInfo.content, { replace: true });
    await prisma.courseMaterial.update({
      where: { id: materialId },
      data: { status: "READY", processedAt: new Date(), extractionLeaseUntil: null },
    });
    await discardUploadBlob(materialId);
  } catch (embeddingError) {
    await failMaterial(
      materialId,
      "MATERIAL_EMBED_FAILED",
      "Material embedding failed during background processing",
      embeddingError,
      requestContext,
    );
  }
}

/**
 * Claim and run one extraction. Returns false when another worker already holds
 * the lease, which is the normal outcome for a losing racer, not an error.
 */
export async function claimAndRunExtraction(
  materialId: string,
  file: File,
  courseId: string,
  userId: string,
  requestContext: RequestContext,
): Promise<boolean> {
  if (!(await claimExtraction(materialId))) return false;
  await runMaterialExtraction(materialId, file, courseId, userId, requestContext);
  return true;
}

/**
 * Start the background half from the request path without awaiting it. The 202
 * has already been earned by the durable write: if this in-process run never
 * finishes — deploy, crash, OOM — the lease expires and the sweeper resumes it
 * from the persisted bytes. Fire-and-forget is now an optimization (the common
 * case completes in-process, seconds after the response) rather than the only
 * chance the upload gets.
 */
export function startMaterialExtraction(
  materialId: string,
  file: File,
  courseId: string,
  userId: string,
  requestContext: RequestContext,
): void {
  void claimAndRunExtraction(materialId, file, courseId, userId, requestContext).catch(
    (error: unknown) => {
      console.error("Material extraction job crashed:", error);
    },
  );
}

/**
 * Resume every upload whose worker died: PROCESSING rows with an expired lease
 * and persisted bytes to re-run from.
 *
 * Scoped to direct uploads by requiring the `pending:` checksum — Canvas imports
 * sit in PROCESSING for reasons this sweeper knows nothing about, and rows with
 * no blob (uploads that predate the durable-bytes migration) are left alone
 * rather than failed on a guess.
 *
 * "Expired lease" is not the only abandoned shape (#1494 review). The row and
 * its blob are committed *before* anything claims them, so a crash in that
 * window — or a claim that simply fails — leaves a PROCESSING row whose lease is
 * still null, which `{ lt: now }` can never match: it would be invisible to
 * every future sweep, and re-uploading the same bytes answers 409. Null leases
 * are therefore swept too, but only once the row is older than a full lease
 * period, so a normal upload in the seconds between its INSERT and its claim is
 * never mistaken for a dead one. Either way the resume goes through
 * `claimExtraction`, so a row that turns out to be live is lost on the claim
 * rather than run twice.
 *
 * Returns a small summary so the caller — and the tests — can see what a pass
 * actually did.
 */
export async function sweepStrandedMaterialExtractions(
  requestContext: RequestContext,
): Promise<{ resumed: number; abandoned: number }> {
  const now = new Date();
  const unclaimedSince = new Date(now.getTime() - EXTRACTION_LEASE_MS);
  const stranded = await prisma.courseMaterial.findMany({
    where: {
      status: "PROCESSING",
      checksum: { startsWith: PENDING_CHECKSUM_PREFIX },
      OR: [
        { extractionLeaseUntil: { lt: now } },
        { extractionLeaseUntil: null, updatedAt: { lt: unclaimedSince } },
      ],
      uploadBlob: { isNot: null },
    },
    // Ids only — never the bytes (#1494 review). Selecting `uploadBlob.bytes`
    // here materialized the whole batch at once: at the documented 50 MB upload
    // cap that is ~1 GB per pass before the `File` copies, which can OOM the
    // process and strand the very backlog the sweep exists to drain. Each blob
    // is fetched inside the loop instead, so at most one upload is resident.
    select: {
      id: true,
      courseId: true,
      uploadedBy: true,
      extractionAttempts: true,
    },
    take: SWEEP_BATCH_SIZE,
  });

  let resumed = 0;
  let abandoned = 0;

  for (const row of stranded) {
    if (row.extractionAttempts >= MAX_EXTRACTION_ATTEMPTS) {
      // Retrying further would just kill another worker on the same bytes.
      await failMaterial(
        row.id,
        "MATERIAL_EXTRACT_ABANDONED",
        `Material extraction abandoned after ${row.extractionAttempts} attempts`,
        new Error("extraction attempts exhausted"),
        requestContext,
      );
      abandoned += 1;
      continue;
    }

    // One blob in memory at a time, and re-read after the batch scan: a row
    // finalized in between has already dropped its blob, so there is nothing to
    // resume from.
    const blob = await prisma.materialUploadBlob.findUnique({
      where: { materialId: row.id },
      select: { bytes: true, fileName: true, mimeType: true },
    });
    if (!blob) continue;

    const ran = await claimAndRunExtraction(
      row.id,
      fileFromBlob(blob),
      row.courseId,
      row.uploadedBy ?? "",
      requestContext,
    );
    if (ran) resumed += 1;
  }

  return { resumed, abandoned };
}

declare global {
  var __materialSweeperTimer: NodeJS.Timeout | undefined;
}

/**
 * Synthetic context for sweeps, which have no request behind them. Keeps
 * `logSystemError` rows from a sweep distinguishable from ones raised on the
 * upload path.
 */
const SWEEPER_CONTEXT: RequestContext = {
  requestId: "material-extraction-sweeper",
  routePath: "lib/materials/extraction-job.server",
  httpMethod: "SYSTEM",
  ipAddress: null,
  userAgent: null,
};

/**
 * Start the in-process sweeper once per process. Deliberately in-process rather
 * than an `infra/cron` entry: resuming an upload means re-running extraction,
 * which lives in this app, and every existing cron script is bash + psql. The
 * lease is what makes running it on every instance safe — a second instance's
 * claim simply loses.
 *
 * Called from `entry.server.tsx` at process startup, not only from the upload
 * path (#1494 review): rows stranded by the crash that just restarted this
 * process must be recovered whether or not anyone uploads again, and an upload
 * is exactly what a stranded row makes impossible — re-uploading the same bytes
 * collides with it and answers 409.
 *
 * The timer is unref'd so it never holds a CLI script or test process open.
 */
export function ensureMaterialSweeperRunning(
  requestContext: RequestContext = SWEEPER_CONTEXT,
): void {
  if (globalThis.__materialSweeperTimer) return;
  const sweep = () => {
    sweepStrandedMaterialExtractions(requestContext).catch((error: unknown) => {
      console.error("Material extraction sweep failed:", error);
    });
  };
  // One pass immediately: at startup the interesting rows are the ones the
  // crash that caused this restart left behind, and waiting a full interval to
  // look at them buys nothing.
  sweep();
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  timer.unref?.();
  globalThis.__materialSweeperTimer = timer;
}

/**
 * True for a Prisma unique-constraint violation on `CourseMaterial`'s
 * `(courseId, checksum)` index. The dedupe check and the write that follows it
 * are not atomic, so two concurrent uploads of the same file can both pass the
 * check and race into the write — the DB constraint (not the check) is the real
 * guard (#225 RAG-04).
 */
export function isChecksumConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
