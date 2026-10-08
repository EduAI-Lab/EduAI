/**
 * Extraction could not run *now* — a full worker pool, an unreachable or overloaded
 * model host — which says nothing about the file itself (#1791, #1903).
 *
 * The extraction job releases a material that fails this way for a later sweep
 * (`MATERIAL_EXTRACT_BUSY`) instead of failing it, within its attempt budget. Its own
 * module so the job can test for it without importing the extractors, and so both the
 * PDF worker pool and the image vision call can throw it.
 */
export class ExtractionBusyError extends Error {
  constructor(message = "Extraction busy: capacity or model host temporarily unavailable") {
    super(message);
    this.name = "ExtractionBusyError";
  }
}
