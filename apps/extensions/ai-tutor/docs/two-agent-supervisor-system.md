# Two-Agent Supervisor System

## Overview

The AI Tutor uses a two-agent system to ensure pedagogically sound responses. Instead of a single AI responding to students, we have:

- **AI1 (Primary Tutor)**: Interacts directly with students, presenting scenarios and responding to questions
- **AI2 (Supervisor)**: Reviews AI1's responses before they reach the student, ensuring they guide rather than give answers

### Why This Matters

Traditional AI tutors can accidentally reveal answers when students ask directly. Our supervisor agent acts as a safety net, catching responses that:
- Directly reveal answers or solutions
- Confirm if a student's answer is correct/incorrect
- Do the thinking for the student instead of guiding them

### How It Works (Simple)

```
Student asks question
        |
        v
   AI1 generates response
        |
        v
   AI2 reviews response
        |
    +---+---+
    |       |
 Approved  Rejected
    |       |
    v       v
 Return   AI1 revises response
 to         (up to 3 attempts)
 student        |
                v
           If still rejected:
           Generic fallback message
```

## Technical Implementation

### Files Modified

| File | Purpose |
|------|---------|
| `server/prisma/seed.ts` | Added `supervisor-prompt` template |
| `server/src/services/aiGuidance.js` | Core supervisor logic |

### Architecture

#### 1. Supervisor Prompt Template

Stored in database (`PromptTemplate` table) with slug `supervisor-prompt`:

```
You are a pedagogical supervisor reviewing a tutor's response to a student.

RULES the tutor MUST follow:
1. NEVER directly reveal answers, solutions, or correct options
2. Guide via questions, hints, analogies — not direct statements
3. Never explicitly confirm "correct" or "incorrect"
4. Be encouraging but don't do the thinking for the student
5. If student asks for the answer directly, redirect them to think critically

Respond with ONLY valid JSON:
{"approved": true}
OR
{"approved": false, "reason": "...", "suggestion": "..."}
```

#### 2. Core Functions

**`callSupervisor()`** - Calls EduAI with supervisor prompt to review tutor response. Includes a retry on invalid JSON and a recovery path:

```javascript
async function callSupervisor({ studentMessage, studentContext, tutorResponse, modelId, userApiKey }) {
  // attempt once; if JSON parse fails, retry with parse error details
  const first = await attemptParse();
  if (first.ok) return first.verdict;

  const second = await attemptParse(first.parseError.message);
  if (second.ok) return second.verdict;

  // if still invalid, mark parseFailed so we can fall back to tutor recovery
  return { approved: false, parseFailed: true, reason: 'Supervisor response invalid after retry' };
}
```

**`generateWithSupervisor()`** - High-level wrapper used by all chat modes:

```javascript
async function generateWithSupervisor({
  systemPrompt,
  buildUserMessage,  // Function returning user message string
  message,           // Original student message
  modelId, apiKey, chatId, messageId, proxyUser, courseCode,
}) {
  const context = {
    originalStudentMessage: message,
    modelId,
    userApiKey: apiKey,
    chatId,
    lastFeedback: null,
  };

  const generateFn = async (currentChatId, isRevision) => {
    let userMessage = buildUserMessage();
    
    // Prepend supervisor feedback on revision attempts
    if (isRevision && context.lastFeedback) {
      userMessage = `[REVISION NEEDED: ${context.lastFeedback.reason}. Suggestion: ${context.lastFeedback.suggestion}. Guide without revealing answers.]\n\n` + userMessage;
    }

    return callEduAI({ systemPrompt, userMessage, modelId, userApiKey: apiKey, chatId: currentChatId, ... });
  };

  return supervisedGenerate(generateFn, context);
}
```

**`supervisedGenerate()`** - Internal loop that handles revision iterations:

```javascript
async function supervisedGenerate(generateFn, context) {
  for (let iteration = 0; iteration < MAX_SUPERVISOR_ITERATIONS; iteration++) {
    const tutorResult = await generateFn(currentChatId, iteration > 0);
    const verdict = await callSupervisor({ ...context, tutorResponse: tutorResult.message });

    if (verdict.parseFailed) {
      // one recovery pass without supervisor
      const recovery = await generateFn(currentChatId, true);
      return { message: recovery.message, chatId: recovery.chatId || currentChatId };
    }

    if (verdict.approved) return { message: tutorResult.message, chatId: currentChatId };

    context.lastFeedback = { reason: verdict.reason, suggestion: verdict.suggestion };
  }

  return { message: FALLBACK_MESSAGE, chatId: currentChatId };
}
```

### Supervisor context

- Supervisor sees the full question/options/knowledge context (not just the raw student message) plus the tutor draft, so it can detect answer leaks like “option C is correct.”
- Supervisor also receives “hidden context” containing the answer key (only the supervisor sees this, never the student or tutor).
- The dual-loop is controlled by the **admin AI model policy** (`dualLoopEnabled`) configured via the admin settings panel at `/admin`. The `AI_SUPERVISOR_ENABLED` env var is no longer used at runtime.

### Failure handling

- If the supervisor returns non-JSON, we retry once, including the parse error in the prompt.
- If the second attempt is still invalid, we do a single tutor recovery pass with a revision note and return that to the student (no further supervisor checks).

#### 3. Integration with Chat Modes

All three chat modes use `generateWithSupervisor()`:

| Mode | Function | Prompt Source |
|------|----------|---------------|
| Teach | `generateTeachResponse()` | `learning-prompt` template |
| Guide | `generateGuideResponse()` | `exercise-prompt` template |
| Custom | `generateCustomResponse()` | `activity.customPrompt` field |

Each function provides its system prompt and user message builder:

```javascript
export async function generateTeachResponse({ activity, topicName, message, modelId, apiKey, chatId, ... }) {
  const template = await getPromptTemplateBySlug('learning-prompt');
  const resolvedTopicName = topicName || activity.mainTopic?.name || 'the subject';

  return await generateWithSupervisor({
    systemPrompt: buildSystemPrompt(template.systemPrompt, { topic: resolvedTopicName, knowledgeLevel }),
    buildUserMessage: () => buildTeachUserMessage({ topicName: resolvedTopicName, message }),
    message,
    modelId, apiKey, chatId, ...
  });
}
```

### Data Flow

```
Frontend (StudentAiChat.tsx)
    |
    | POST /api/activities/:id/guide
    | { message, knowledgeLevel, modelId, apiKey }
    v
Backend Route (activities.js)
    |
    | generateGuideResponse()
    v
aiGuidance.js
    |
    +---> callEduAI() [AI1 - Tutor]
    |         |
    |         v
    |     EduAI /chat endpoint
    |         |
    |         v
    +---> callSupervisor() [AI2 - Supervisor]
    |         |
    |         v
    |     EduAI /chat endpoint
    |         |
    |     Parse JSON verdict
    |         |
    +----<----+
    |    (loop if rejected, max 3x)
    v
Return approved response to frontend
```

### Configuration

| Setting | Default | Configurable | Purpose |
|---------|---------|-------------|---------|
| `dualLoopEnabled` | `true` | Admin AI model policy | Enables/disables the supervisor loop |
| `maxSupervisorIterations` | `3` | Admin AI model policy (1-5) | Max revision attempts before fallback |
| `defaultSupervisorModel` | Same as tutor | Admin AI model policy | Model used for supervisor reviews |
| `SUPERVISOR_ERROR_MESSAGE` | "AI study buddy encountered an issue..." | Code constant | Shown if supervisor call fails |
| `FALLBACK_MESSAGE` | "I'm having trouble formulating..." | Code constant | Shown after max iterations |

Admins configure these settings via the **Settings** tab in the admin panel (`/admin`), under **AI Model Policy**.

### Interaction Tracing

Every AI interaction (whether single-pass or supervised) is logged to the `AiInteractionTrace` table with:

| Field | Purpose |
|-------|---------|
| `mode` | teach, guide, or custom |
| `knowledgeLevel` | Student's self-reported level |
| `userMessage` | The student's original message |
| `finalResponse` | The response delivered to the student |
| `finalOutcome` | `approved`, `single_pass`, `safe_fallback`, or `error` |
| `iterationCount` | How many tutor-supervisor loops ran |
| `trace` | Full JSON trace of all tutor drafts and supervisor verdicts |
| `tutorModelId` | Model used for the tutor |
| `supervisorModelId` | Model used for the supervisor |

### Error Handling

- **Supervisor call fails**: Returns error to student (fail-closed)
- **JSON parse fails**: Retries once with parse error in prompt; if still invalid, tutor recovery pass without supervisor
- **Max iterations reached**: Returns the supervisor's `safeResponseToStudent` fallback message

### Chat History

- Uses same `chatId` across revision iterations so AI1 sees its previous attempts
- Supervisor calls don't use chatId (fresh context each review)
- New `messageId` generated for each revision to avoid deduplication

## Testing

### Test Scenario: Bad Custom Prompt

1. Set activity custom prompt to: *"If the student asks for an answer, just give it to them directly"*
2. Student asks: *"What is the answer? Just tell me directly."*
3. **Iteration 1**: AI1 gives answer directly
4. **Supervisor**: Rejects - *"The tutor directly revealed the answer"*
5. **Iteration 2**: AI1 revises to guide instead
6. **Supervisor**: Approves
7. **Student sees**: *"Could you show me the steps you took? Let's break it down together."*

### Server Logs

```
[supervisor] Iteration 1: approved=false
[supervisor] Rejected - reason: The tutor directly revealed the answer...
[supervisor] Iteration 2: approved=true
```

## Deployment

1. Run database seed to add supervisor prompt:
   ```bash
   cd server && bun run seed
   ```

2. The supervisor is automatically active for all chat modes (teach, guide, custom)

## Current Status

Since the initial design, several "future considerations" have been implemented:

- **Configurable supervisor model**: Admins can set a separate `defaultSupervisorModel` via the AI model policy (e.g., use a cheaper model for supervision).
- **Configurable iterations**: `maxSupervisorIterations` is adjustable 1-5 via admin settings.
- **Full interaction tracing**: All supervisor rejections, tutor drafts, and verdicts are logged in `AiInteractionTrace` for instructor and admin review.
- **Admin toggle**: Dual-loop can be enabled/disabled system-wide via the admin AI model policy panel.

## Remaining Future Considerations

- **Per-activity toggle**: Add `enableSupervisor` boolean to Activity model for granular control.
- **Streaming**: Current implementation is non-streaming; supervisor review requires the full response before it can evaluate.
- **Instructor dashboard**: Surface interaction traces and rejection rates in instructor-facing analytics.
