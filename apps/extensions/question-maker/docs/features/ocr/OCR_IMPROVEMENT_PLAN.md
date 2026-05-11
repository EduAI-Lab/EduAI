# OCR / Question Extraction — Robustness Plan

This document identifies **potential failing points** in the current OCR → extraction pipeline and proposes a **concrete improvement plan**. The pipeline covers: PDF/image text extraction (frontend), text normalization and chunking, and AI-based question extraction (backend via EduAI).

**Example failure case:** A PDF like `app/backend/test/ocr_tests/Java_PriorityQueue_Bank_Client_Assignment.pdf` (multipart assignment with questions that have (a), (b), (c) sub-parts) can cause the extractor to "break" — e.g. splitting one logical question into several, dropping sub-parts, or merging unrelated content.

---

## 1. Current Flow Summary

| Stage | Location | What happens |
|--------|----------|----------------|
| **PDF text** | `QuestionUploadDialog.tsx` | `pdfjs-dist`: `getDocument` → `getPage` → `getTextContent()`; items joined with space per page, `\n` between pages. |
| **Image text** | Same | Tesseract.js OCR. |
| **TXT** | Same | `file.text()`. |
| **Extract API** | `POST /api/questions/extract` | Receives raw text, calls `extractQuestionsFromText` in `aiService.js`. |
| **Normalize** | `aiService.js` | `normalizeExtractText()`: trim, collapse newlines/tabs. |
| **Chunk** | `aiService.js` | `chunkText(text, 4000)` — **fixed 4000-character boundaries**, no semantic awareness. |
| **Per-chunk extraction** | `extractQuestionsWithEduAI()` | For each chunk: build prompt, call `eduaiService.generateQuestions()` with `numQuestions = calculateQuestionTarget(chunk)`, sanitize and dedupe. |

---

## 2. Failing Points

### 2.1 Multipart questions and chunk boundaries (high impact)

- **Problem:** `chunkText()` splits at exactly 4000 characters. A long assignment with "Question 1 (a) … (b) … (c)" can be cut mid-question. Each chunk is then sent to the model independently, so:
  - One question can be split into two “questions” (e.g. (a)–(b) in one chunk, (c) in the next).
  - Sub-parts can be dropped or duplicated.
  - The model is asked to “extract N questions” per chunk but is not told “this chunk might be the continuation of the previous one.”
- **Where:** `app/backend/src/services/aiService.js`: `chunkText()`, `extractQuestionsWithEduAI()` loop.

### 2.2 No semantic / structure-aware chunking (high impact)

- **Problem:** Chunking ignores:
  - Numbered question boundaries (e.g. `1.`, `2.`, `Question 1`, `Part A`).
  - Sub-part markers: `(a)`, `(b)`, `(i)`, `(ii)`.
  - Section headers or “Instructions” blocks.
- **Effect:** Even when the prompt says “keep (a)(b)(c) together,” the input to the model is often a fragment that doesn’t contain a full question block, so the model cannot comply.
- **Where:** Same as 2.1; no pre-pass to detect question boundaries.

### 2.3 PDF text extraction loses structure (medium impact)

- **Problem:** In `QuestionUploadDialog.tsx`, PDF text is built as:
  - Per page: `content.items.map(item => item.str).join(' ')` — so **all items on a page are joined with a single space**. Line breaks and paragraph structure within a page are lost.
- **Effect:** “Question 1\n(a) …” can become “Question 1 (a) …”, and long paragraphs become one run-on line. That makes it harder for both:
  - Any future “split by newline” heuristics.
  - The model (less clear where one question ends and the next begins).
- **Where:** `app/frontend/src/components/question-bank/QuestionUploadDialog.tsx` — `performPdfOcr()`.

### 2.4 Extraction prompt vs. “generate” API (medium impact)

- **Problem:** The backend uses `eduaiService.generateQuestions()`, which is built for “generate N questions from a topic/topic description.” For extraction we pass “source material” in the prompt and ask to “extract” questions. The EduAI system prompt is tuned for generation (difficulty distribution, reasoning_level, etc.), not for “return exactly the question blocks that appear in this text, preserving sub-parts.”
- **Effect:** The model may still merge/split or “interpret” instead of strictly extracting, especially when the chunk is ambiguous (e.g. mid-question).
- **Where:** `aiService.js` (extraction prompt), `eduaiService.js` (`generateQuestions` system/user prompts).

### 2.5 Question target and chunk size (low–medium impact)

- **Problem:** `calculateQuestionTarget(chunk)` estimates questions by `chunk.length / 900` (capped 3–12). For extraction, the “right” number is “as many complete question blocks as are in this chunk.” Asking for too few can merge questions; asking for too many can encourage the model to split one question into several.
- **Where:** `aiService.js`: `calculateQuestionTarget()`, and the way `numQuestions` is passed into EduAI.

### 2.6 Deduplication key too broad (low impact)

- **Problem:** Deduplication uses `summary + "::" + question` (lowercased). Two different questions with the same summary and very similar text could be collapsed; or minor wording differences could still produce duplicates that aren’t caught if one field differs.
- **Where:** `extractQuestionsWithEduAI()` at the end: `seen` set and `deduped` array.

### 2.7 Scanned PDFs / images (lower priority for “multipart” but important for robustness)

- **Problem:** For scanned PDFs (or image-only PDFs), the frontend currently uses pdf.js text extraction only; there is no fallback to Tesseract for PDFs. So scanned PDFs may yield no or garbage text.
- **Where:** `QuestionUploadDialog.tsx`: PDF branch only uses `performPdfOcr` (text extraction), not Tesseract.

### 2.8 No explicit handling of instructions or preamble

- **Problem:** Assignment-wide instructions (e.g. “Answer all questions; show your work”) might be attached to the first question or dropped. The prompt says “preserve instructions” but doesn’t define whether they belong in `question`, `instructions`, or a separate field.
- **Where:** Extraction prompt and `sanitizeEduAIQuestion` / save payload.

---

## 3. Improvement Plan

### 3.1 Semantic / question-boundary-aware chunking (backend)

**Goal:** Never split a single multipart question across chunks; prefer to split only at clear question boundaries.

**Steps:**

1. **Add a “question block” splitter** (new helper in `aiService.js` or a small `extractionUtils.js`):
   - Option A — Regex-based: Split on patterns like:
     - `\n\s*(\d+[.)]\s+|Question\s*\d+|Part\s+[A-Z]\s*[:.]?)`
     - Keep sub-parts `(a)`, `(b)`, `(i)`, `(ii)` attached to the previous block (do not start a new block on those).
   - Option B — Line-based heuristics: Detect “new question” when a line starts with a number + period/paren, or “Question N”, and treat `(a)`, `(b)` as continuations.
   - Produce an array of **question-block strings** (each block = one main question including all its sub-parts).

2. **Chunk by blocks, not by raw character count:**
   - Concatenate blocks until adding the next block would exceed a max chunk size (e.g. 4000–6000 chars).
   - Start a new chunk at a block boundary. No chunk should end mid-block.

3. **Replace the current `chunkText(text, 4000)` call** in `extractQuestionsWithEduAI()` with this block-aware chunking. Fallback: if no boundaries detected, use one chunk (or fall back to current fixed-size chunking for that segment).

**Files to change:** `app/backend/src/services/aiService.js` (and optionally a shared util module).

---

### 3.2 Stronger extraction prompt and “extract” semantics (backend)

**Goal:** Make the model treat the task as “extract exactly the question blocks in the text” rather than “generate N questions.”

**Steps:**

1. **Tighten the extraction prompt** in `extractQuestionsWithEduAI()`:
   - Explicitly: “One output question per logical question block. A logical question block includes all sub-parts (a), (b), (c), etc. Do not split a single numbered question into multiple entries; do not merge two different numbered questions.”
   - Add 1–2 short examples of “one block” (e.g. “1. (a) … (b) … (c) …” → one question with full text).
   - If the chunk is a continuation (e.g. we later add “chunk 2 continues from chunk 1”), say so in the prompt so the model doesn’t invent a new “Question 1” at the start of chunk 2.

2. **Consider an extraction-specific EduAI path** (if the API supports it): e.g. an “extract” endpoint or a distinct system prompt that omits “generate exactly N” and uses “list every complete question block in the following text.” If not available, keep using `generateQuestions` but set `numQuestions` from the number of **blocks** in the chunk (from 3.1) instead of from character count.

**Files to change:** `app/backend/src/services/aiService.js` (prompt and, if needed, `numQuestions` from block count).

---

### 3.3 Preserve PDF layout (line breaks) in the frontend (medium priority)

**Goal:** Preserve line breaks and approximate paragraph structure so downstream chunking and the model see “Question 1” and “(a)” on separate lines when the PDF has them that way.

**Steps:**

1. In `performPdfOcr()`, use text item positions (e.g. `item.transform`, `item.height`) to detect when the Y position changes “enough” to insert a newline instead of a space. Many PDFs expose text items with coordinates; a simple approach is to insert `\n` when `y` drops by more than a small threshold (e.g. half a line height).
2. If the PDF library exposes a “get text with layout” or “items with position” API, prefer that and build a small “items to lines” pass (group by similar Y, then sort by X, then join with space within line and `\n` between lines).
3. Keep a fallback: if position data is missing or unreliable, keep the current space-join behavior so we don’t regress.

**Files to change:** `app/frontend/src/components/question-bank/QuestionUploadDialog.tsx` — `performPdfOcr()`.

---

### 3.4 Use block count for `numQuestions` when available (backend)

**Goal:** When we have block-aware chunking (3.1), pass the number of blocks in the chunk as the target count (or a small range, e.g. `blocks.length` to `blocks.length + 1`) so the model is not asked for an arbitrary N that doesn’t match the content.

**Steps:**

1. From the block splitter, get `blocks.length` for the current chunk.
2. Set `numQuestions` (or equivalent) to `blocks.length` (or min/max around it) when calling EduAI for that chunk, instead of `calculateQuestionTarget(chunk)`.
3. Keep `calculateQuestionTarget(chunk)` as fallback when no blocks are detected.

**Files to change:** `app/backend/src/services/aiService.js` — `extractQuestionsWithEduAI()` loop.

---

### 3.5 Deduplication and ordering (backend, low priority)

**Goal:** Avoid dropping distinct questions that look similar; avoid duplicate entries from overlapping chunks.

**Steps:**

1. Consider a more stable key: e.g. first 100 chars of normalized question text + length, or a hash, so that minor wording changes don’t create duplicates while true duplicates are still removed.
2. If we add overlap between chunks (e.g. “last block of chunk 1” repeated as “first block of chunk 2” for context), dedupe more aggressively and prefer the version that has more context (e.g. longer text).
3. Preserve order: when merging chunk results, keep the order of questions as they appeared in the source (e.g. by tracking chunk index and position within chunk).

**Files to change:** `app/backend/src/services/aiService.js` — dedupe logic and any ordering metadata.

---

### 3.6 Scanned PDF fallback (frontend, later)

**Goal:** For PDFs that yield no or very little text, optionally run Tesseract on rendered page images (e.g. canvas render of each page) and use that text for extraction. This is a larger change (rendering, performance, UX) and can be phased after 3.1–3.4.

**Files to change:** `QuestionUploadDialog.tsx` — PDF branch: detect “no text” or “too short,” then switch to page-by-page render + Tesseract.

---

### 3.7 Instructions and preamble (backend + schema, optional)

**Goal:** Consistently attach assignment-wide instructions to the first question or to an `instructions` field so they aren’t lost.

**Steps:**

1. In the extraction prompt, define: “If the document starts with general instructions (e.g. ‘Answer all questions’), put them in the first question’s text or in an `instructions` field.”
2. Ensure `sanitizeEduAIQuestion` and the save payload preserve `instructions` and that the UI can show it (already partially supported).
3. No schema change required if we only store in existing `instructions` or in the first question’s description.

**Files to change:** `aiService.js` (prompt), and confirm frontend/backend save flow for `instructions`.

---

## 4. Implementation status

| Item | Status |
|------|--------|
| **§6 Production parity** | Documented; single code path, no env gating. |
| **3.1** Block-aware chunking | Done in `aiService.js`: `splitIntoQuestionBlocks`, `chunkByQuestionBlocks`. |
| **3.2** Stronger extraction prompt | Done: multipart rules, one-block example, continuation note for chunk 2+. |
| **3.4** Block count for `numQuestions` | Done: per-chunk `blockCountsPerChunk` used when > 0. |
| **Unit tests** | `app/backend/test/extraction.test.js` — block split and chunk tests; Jest ESM via `jest.config.js` + `node --experimental-vm-modules`. |
| **3.3** PDF line-break preservation | Done in `QuestionUploadDialog.tsx`: `pdfItemsToTextWithLineBreaks` (uses `hasEOL`; fallback `pdfItemsToTextByPosition` by Y). |
| **3.5** Deduplication and ordering | Done in `aiService.js`: `extractedQuestionDedupeKey` (normalized prefix 150 chars), `deduplicateExtractedQuestions` (preserves order, keeps longer when same key). |
| **Extraction prompt vs generate** | Done: EduAI `generateQuestions` accepts `systemPromptOverride` and `userPromptOverride`; extraction uses extraction-specific system/user prompts (extract only, assignment parts as blocks). |
| **Block detection (Part/Task/Exercise/Section)** | Done: `splitIntoQuestionBlocks` regex includes Part 1, Task N, Exercise N, Section N; unit test added. |
| **OCR history on background extraction** | Done: `BackgroundExtractionParams` has `jobId` and `onExtractionComplete`; Homepage calls callback on success/error so job status is updated. |
| **Test script (ocr_tests PDFs)** | Done: `npm run test:ocr` (or `node scripts/testOcrExtraction.js [path]`) uses pdf-parse to extract text and runs block detection on PDFs in `test/ocr_tests`. |
| **3.6–3.7** | Not yet implemented. |

---

## 5. Suggested Implementation Order

| Priority | Item | Impact | Effort |
|----------|------|--------|--------|
| 1 | **3.1** Semantic / block-aware chunking | High | Medium |
| 2 | **3.2** Stronger extraction prompt | High | Low |
| 3 | **3.4** Use block count for `numQuestions` | High | Low (depends on 3.1) |
| 4 | **3.3** PDF line-break preservation | Medium | Medium |
| 5 | **3.5** Deduplication and ordering | Low | Low |
| 6 | **3.7** Instructions handling | Low | Low |
| 7 | **3.6** Scanned PDF fallback | Medium (for scanned docs) | High |

---

## 6. Testing

- **Regression:** Run extraction on existing test PDFs (and TXT samples) and compare question count and that multipart questions stay in one piece.
- **Target:** Use `Java_PriorityQueue_Bank_Client_Assignment.pdf` (or a similar multipart assignment) as the main test: after changes, expect one extracted “question” per numbered question, with (a), (b), (c) etc. preserved in a single question text.
- **Verified:** `app/backend/test/ocr_tests/COSC 121 - Java_PriorityQueue_Bank_Client_Assignment.pdf` has been successfully scraped with the current pipeline.
- **Unit tests:** Add tests in `app/backend/test/` for:
  - Block-splitting helper: sample strings with “1. (a) … (b) … 2. (a) …” and assert correct block boundaries.
  - Chunking: assert no block is split across chunks and chunk size stays within limit.

---

## 7. Production parity: OCR robustness in production

**Requirement:** Production OCR must be **at least as robust** as development. The same extraction pipeline (block-aware chunking, extraction prompt, EduAI config) must run in all environments.

**Principles:**

- **Single code path:** Do not gate the robust extraction logic (semantic chunking, multipart handling) behind `NODE_ENV` or feature flags. Production and development must use the same `extractQuestionsWithEduAI` flow.
- **Config parity:** Production must have `EDUAI_API_URL` and `EDUAI_API_KEY` set so extraction uses the same EduAI service. Rely on existing config validation (e.g. encryption key required in production); ensure EduAI is documented for deploy.
- **No silent fallbacks in production:** If block detection fails, fall back to legacy fixed-size chunking so extraction still runs; do not skip extraction or return empty in production only.
- **Testing:** Run the same extraction tests (e.g. against `Java_PriorityQueue_Bank_Client_Assignment.pdf` or equivalent) in CI or staging so regressions are caught before production. Prefer running backend extraction tests in the same way in dev and CI.
- **Deployment checklist:** Document in deployment/runbooks that OCR/extraction depends on EduAI being reachable and that the extraction pipeline is identical in production and development.

**References:** `app/backend/src/config/settings.js` (EduAI env vars), `app/backend/src/services/aiService.js` (extraction entry point).

---

## 8. References

- Extraction entry: `POST /api/questions/extract` — `app/backend/src/routes/questions.js`
- Extraction logic: `app/backend/src/services/aiService.js` — `extractQuestionsFromText`, `extractQuestionsWithEduAI`, `chunkText`, `normalizeExtractText`
- PDF text: `app/frontend/src/components/question-bank/QuestionUploadDialog.tsx` — `performPdfOcr`
- EduAI client: `app/backend/src/services/eduaiService.js` — `generateQuestions`
- Test PDF: `app/backend/test/ocr_tests/Java_PriorityQueue_Bank_Client_Assignment.pdf`
