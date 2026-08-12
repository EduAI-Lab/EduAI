# Core Student & TA end-user testing (#1429, #1459)

## Workflow tested

Student course chat happy path: an enrolled student opens `/chat` for a published course, acknowledges the chat privacy notice, submits a course question, and reads the streamed assistant response.

The browser path is persisted as [`tests/e2e/tests/core/ai-chat-happy-path.spec.ts`](../../tests/e2e/tests/core/ai-chat-happy-path.spec.ts). The AI provider response is mocked only at the stream boundary so the test remains deterministic while the course enrollment, publish state, session, route, composer, privacy notice, streaming renderer, and response surface remain real.

## Findings

1. **Does it make sense?** Yes. The student enters a course-scoped chat, asks a plain-language question, and receives an answer in the same conversation.
2. **Is the UI clear?** Yes for the exercised path: the privacy acknowledgement is explicit, the composer has an accessible input and “Send message” action, and the submitted question and assistant response are distinguishable text surfaces.
3. **Bugs found/fixed.** No defect reproduced in this workflow; the new test protects the happy path.
4. **Security.** The setup enrolls the student before opening chat and uses the course code in the URL. The test does not grant instructor or admin permissions to the student. A separate authorization-focused pass is still required for cross-course and unpublished-course chat access.
5. **Documentation.** This file records the path and findings; the test is listed in `TESTS.md`.

## Human-pass status

The live browser is reachable again. I manually opened Course Chat as the currently signed-in Admin account. The UI clearly reported: “You're not enrolled in any courses. Chat will become available once you're enrolled,” disabled the course selector, model selector, composer, suggested prompts, and Send action, and exposed the disclaimer and “View full terms” action. This is a coherent permission/empty state and did not expose course chat to the un-enrolled account.

The exact enrolled-Student human pass remains outstanding because the available live session is Admin and no student credentials were supplied. The automated browser test covers the enrolled-Student path deterministically; it is not a substitute for a human Student sign-off.
