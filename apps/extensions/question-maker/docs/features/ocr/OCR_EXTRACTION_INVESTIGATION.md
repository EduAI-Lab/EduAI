# OCR Extraction Investigation — Java PriorityQueue Assignment

**Context:** User ran OCR on `COSC 121 - Java_PriorityQueue_Bank_Client_Assignment.pdf` multiple times. Results: (1) sometimes extracted questions were not the actual assignment questions but AI-generated variants (e.g. MCQs about time complexity); (2) sometimes the AI returned “no explicit exam-style question blocks” and the toast showed the error, but the OCR history entry stayed “Processing” instead of “Failed”.

**Scope:** Investigate before implementation. This doc summarizes root causes and recommended fixes.

**Implementation status (done):** Extraction-specific system/user prompt overrides in EduAI; block detection broadened (Part 1, Task 1, Exercise 1, Section 1); OCR history completion callback (jobId + onExtractionComplete) so background extraction updates job to success/error; test script `npm run test:ocr` and unit tests for new block patterns.

**Verified:** `app/backend/test/ocr_tests/COSC 121 - Java_PriorityQueue_Bank_Client_Assignment.pdf` has been successfully scraped (extraction works with the current pipeline).

---

## 1. Why the model “improvises” instead of extracting

### What happens today

- Extraction goes through **`eduaiService.generateQuestions()`** in `app/backend/src/services/eduaiService.js`.
- **System prompt** (in `generateQuestions`) is fixed and **generation-oriented**:
  - “You are an expert question **generator** for educational assessments.”
  - “**Generate** exactly N high-quality questions **based on** the course material.”
  - “Generate questions about: ${prompt}”
  - “Please ensure the questions are appropriate for the course level and cover the key concepts comprehensively.”
- The **user** message is the extraction prompt from `aiService.js`, which includes the source chunk and says “EXTRACT … do not generate new content”.

So the model sees:

- **System:** generate N questions from the material; cover key concepts.
- **User:** here is raw assignment text; extract only what’s there; do not generate.

The system prompt dominates the framing (“generate … based on course material”), so the model tends to **generate** questions inspired by the PDF (e.g. “What are the average-case time complexities of offer, poll, and peek?”) instead of **extracting** the actual assignment tasks verbatim.

### Evidence

- Terminal logs show EduAI returning MCQs/SA/LA that look like generated exam questions (time complexity, Comparator ordering, etc.) rather than the literal assignment parts.
- Extraction prompt in `aiService.js` (e.g. “EXTRACTS … do not generate new content”) is in the **user** message; the **system** message in `eduaiService.generateQuestions` is never overridden for extraction.

### Recommended direction

- **Option A (preferred):** Add an **extraction-specific code path** that does **not** use the generator system prompt. For extraction only, call EduAI with a **system prompt that says “extract only; do not generate; preserve wording verbatim”** and keep the current user prompt (chunk + instructions). If EduAI exposes a separate “extract” endpoint, use it; otherwise keep using the same chat endpoint but pass an extraction-specific system prompt and keep the existing user prompt.
- **Option B:** Keep using `generateQuestions` but allow an optional override system prompt (e.g. `extractionSystemPrompt`) so that for extraction we send the extraction instructions as the system message and the chunk as the user message, without the “generate exactly N” framing.

---

## 2. Why “no explicit exam-style question blocks” appears

- The EduAI `generateQuestions` flow supports **error objects**: if the model returns `{ "error": true, "reason": "..." }`, the backend throws with that reason (e.g. “The provided source material contains assignment specifications and requirements, but it does not include any explicit exam-style question blocks…”).
- So the model is **refusing** to return questions when it doesn’t see classic “numbered questions with sub-parts”. That can happen when:
  - The assignment uses different structure (e.g. “Part 1”, “Task 1”, “Exercise 1”, or prose instructions without “1.” / “Question 1”).
  - Our **block splitter** in `aiService.js` only looks for `\n\s*(?=\d+[.)]|Question\s+\d+|Part\s+[A-Z])`. If the PDF uses “Part 1” with a digit, it might match; if it uses “Task” or “Section” or no clear pattern, we fall back to **fixed-size chunking**, and the chunk may look like a block of specs rather than “question blocks”.
- So we get either:
  - Chunks that don’t look like exam-style questions → model returns the error object, or
  - Chunks that do → model sometimes still “generates” because of the system prompt (see §1).

### Recommended direction

- Broaden **block detection** (e.g. “Part 1”, “Task 1”, “Exercise 1”, “Section 1”) so more assignment structures are treated as question boundaries and we send clearer “one block = one task” chunks.
- In the **extraction system prompt** (once we have one), explicitly allow **assignment tasks/specs** as extractable units even when they are not “numbered questions with sub-parts” (e.g. “Treat each Part/Task/Exercise as one question block; preserve the exact wording.”). That should reduce unnecessary “no explicit exam-style question blocks” refusals while still extracting real content.

---

## 3. Why the OCR history job stays “Processing” when extraction fails

### Flow today

1. User drops file in the upload dialog → **`addJob`** (status `pending`) → **`updateJobStatus(jobId, 'processing')`**.
2. OCR runs (PDF → text).
3. If **background extraction** is used: dialog calls **`onExtractInBackground({ text, courseId, model, apiKeys })`** and **closes**. The **jobId is not passed** to the parent.
4. **Homepage** runs `questionService.extractQuestionsFromText(...)` in **`handleExtractInBackground`**. On success it shows a toast and sets `pendingExtractionDrafts`. On **failure** it only **dismisses the processing toast** and shows an error toast; it has **no jobId and no reference to OCR history**, so it **never** calls `updateJobStatus(jobId, 'error', { error })`.
5. The job remains in **`processing`** because nothing ever updates it to `error` (or `success` when extraction succeeds in background).

### Where it’s implemented

- **Dialog:** `app/frontend/src/components/question-bank/QuestionUploadDialog.tsx` — `processFile` creates the job, sets `processing`, calls `onExtractInBackground` **without jobId**.
- **Homepage:** `app/frontend/src/pages/Homepage.tsx` — `handleExtractInBackground` has no `jobId` and does not use `useOCRHistory`, so it cannot update the job.

### Recommended fix

- **Pass completion callback (and jobId) from dialog to parent:** Extend **`BackgroundExtractionParams`** (e.g. in `QuestionUploadDialog.tsx`) to include:
  - **`jobId: string`**
  - **`onExtractionComplete: (status: 'success' | 'error', extras?: { error?: string; questionsCount?: number }) => void`**
- In **`processFile`**, when calling `onExtractInBackground`, pass `jobId` and a callback that invokes **`updateJobStatus(jobId, status, extras)`** (the dialog already has `updateJobStatus` from `useOCRHistory`).
- In **Homepage** `handleExtractInBackground`:
  - In **`.then()`**: if drafts.length > 0, call `params.onExtractionComplete?.('success', { questionsCount: drafts.length })`; if drafts.length === 0, call `params.onExtractionComplete?.('error', { error: 'No questions extracted' })`.
  - In **`.catch()`**: call `params.onExtractionComplete?.('error', { error: message })`.
- No need for Homepage to use `useOCRHistory`; the dialog owns the job and passes a callback that updates that job. Result: on extraction failure (including EduAI error object), the history entry is set to **Failed** and can show the error message.

---

## 4. Summary table

| Issue | Root cause | Recommended fix |
|--------|------------|------------------|
| Model “improvises” (generates MCQs/SA/LA from topic instead of extracting assignment text) | Extraction uses `generateQuestions()` whose **system** prompt is “generate N questions based on course material”; extraction instructions are only in the user message | Use an extraction-specific system prompt (or endpoint): “extract only; preserve wording; do not generate.” Optionally allow system-prompt override in EduAI client for extraction. |
| Model returns “no explicit exam-style question blocks” for a valid assignment | Block splitter may not detect this PDF’s structure; model is instructed to refuse when it doesn’t see classic question blocks | Broaden block detection (Part/Task/Exercise, etc.). In extraction prompt, allow assignment tasks/specs as extractable blocks. |
| OCR history shows “Processing” when extraction fails | `onExtractInBackground` does not pass `jobId`; parent never calls `updateJobStatus(jobId, 'error')` | Add `jobId` and `onExtractionComplete` to background params; parent calls callback on success/failure; dialog’s callback calls `updateJobStatus(jobId, status, extras)`. |

---

## 5. References

- Extraction flow: `app/backend/src/services/aiService.js` → `extractQuestionsWithEduAI` (builds prompt, calls `eduaiService.generateQuestions`).
- EduAI generator: `app/backend/src/services/eduaiService.js` → `generateQuestions` (fixed system prompt, error object handling at ~293–296).
- Background extraction: `QuestionUploadDialog.tsx` → `processFile`, `onExtractInBackground`; `Homepage.tsx` → `handleExtractInBackground`.
- OCR history: `app/frontend/src/hooks/use-ocr-history.ts`, `app/frontend/src/types/ocr.ts` (status: `pending` | `processing` | `success` | `error` | `discarded`).
- OCR improvement plan: `docs/troubleshooting/OCR_IMPROVEMENT_PLAN.md`.
