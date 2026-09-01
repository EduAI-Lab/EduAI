# Future work

Ideas and improvements we may tackle over time. Nothing here is promised on a fixed schedule—this
list helps us remember what matters next. (Password reset, the monthly-EduAI-key-rotation pain, and
the "Core doesn't have a topics API yet" item that used to live here are resolved: auth is entirely
Core's session cookie now, and course topics read through Core live via `services/courseListService.js`
and `services/topicSyncService.js`.)

- **Scanned-PDF OCR fallback** — The upload dialog extracts a PDF's text layer with `pdfjs-dist` and
  falls back to `tesseract.js` for image uploads, but not yet for a scanned/image-only PDF (no text
  layer). See §3.6 of [features/ocr/OCR_IMPROVEMENT_PLAN.md](features/ocr/OCR_IMPROVEMENT_PLAN.md).
- **Assignment-preamble handling** — Assignment-wide instructions that precede the first numbered
  question aren't consistently attached anywhere during extraction. See §3.7 of the same plan.
- **Broader walkthrough testing** — Try key flows in a real browser against test systems (Playwright/
  Cypress), not only Vitest unit/integration checks.
- **Reliable automatic updates** — Keep the scheduled "pull latest `development`" server job
  (`docs/deployment/cron.md`) healthy so reviewed fixes reach production without a manual deploy.
