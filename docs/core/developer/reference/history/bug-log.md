The file involved was:
Connecting Discrete Mathematics and Computer Science.pdf
At 3:21 PM:
MATERIAL_EXTRACT_FAILED:
Failed to extract text from PDF:
PDF extraction exceeded the 30000ms wall-clock limit
and was terminated
At 3:28 PM:
MATERIAL_EXTRACT_FAILED:
PDF extraction worker was killed (signal SIGKILL)
after exceeding the 640MB RSS hard limit
The resulting upload requests returned HTTP 500:
POST /api/courses/.../materials 500
The failures occurred three times:
15:31:14 — HTTP 500
15:31:50 — HTTP 500
15:34:19 — HTTP 500
Diagnosis
- This does not look like a basic upload-size, permission, or disk-full problem:
- The server has approximately 3.2 GB free disk space.
- There were no HTTP 413 errors.
- There were no “permission denied” or “disk full” messages.
- The upload endpoint is failing during synchronous PDF text extraction.
- The extraction process exceeds either the 30-second timeout or its 640 MB memory limit.
- There is also a separate embedding error in the logs:
MATERIAL_EMBED_FAILED:
This model's maximum context length is 512 tokens,
but the prompt contained at least 513 tokens
That occurred at 3:15 PM and 3:17 PM. Therefore, there are currently two related processing problems:
Some PDFs fail during extraction because the extractor times out or exceeds its memory limit.
Extracted material can fail during embedding if a chunk exceeds the embedding model’s 512-token limit.
The embedding container itself is running, so this is no longer the previous NVIDIA/Docker outage.
Likely fixes
For the PDF issue:
- Increase the extraction timeout and memory limit, or process extraction asynchronously.
- Add file/page limits and clearer user-facing errors.
- Avoid returning a generic HTTP 500 after a worker timeout.
For the embedding issue:
- Reduce chunk size so chunks remain safely below 512 tokens, perhaps around 350–400 tokens.
- Add a token-count check before sending chunks to mxbai-embed-large.
- Retry or split oversized chunks automatically.
- No changes were made on the server.