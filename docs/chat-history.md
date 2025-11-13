
# Chat History & Proxy User Architecture

This document explains the recent changes to `/api/chat`, why they were made, and how other services (such as Aitutor) should integrate with the updated flow.

## Goals

- Persist every chat turn server-side so clients no longer need to resend the full conversation.
- Allow trusted services to act on behalf of users via `proxyUser`, while keeping EduAI’s authorization model intact.
- Keep chat responses grounded in course context without loading an entire conversation history into memory.

## Data Model Changes

### `ChatMessage`

- New table that stores each AI SDK message envelope.
- Columns:
  - `chatId` – FK to `Chat`.
  - `messageId` – Original message id from the AI SDK (unique per chat).
  - `role`, `content` – Raw message data (stored as JSON).
  - `position` – Auto-incremented sequence used for ordering.
- We only fetch the latest 20 message rows per request (matching the context window we send to the LLM) and rely on `skipDuplicates` + the `(chatId, messageId)` unique constraint to avoid double inserts.

### `ExternalUser`

- Maps `(provider, externalUserId)` → `userId`.
- Stores the upstream email for reference, but the main `User.email` remains the canonical login/contact field inside EduAI.
- When a proxy call supplies a new email, we update `ExternalUser.email` only; we do **not** overwrite the user’s EduAI email automatically.

## Request Flow Overview

1. **Auth Guard** – Requests with `x-api-key` still require an ADMIN user. If no API key is present we fall back to the caller’s session.
2. **Proxy User (optional)** – Admin-key calls may include:
   ```json
   {
     "proxyUser": {
       "provider": "aitutor",
       "id": "aitutor-user-123",
       "email": "student123@example.com"
     }
   }
   ```
   EduAI autoprovisions (or reuses) a `User` tied to this mapping, then runs the rest of the pipeline as that user.
3. **Chat Lookup** – We scope the `chatId` to the acting user. If the chat was deleted or belongs to someone else we return `410 Gone` with `{ "chatDeleted": true }` so clients know to drop the stale id.
4. **History Merge** – Load the latest 20 stored messages, then merge in whatever new turns the client sent (de-duped by `messageId`). Keep the merged array trimmed to 20 before passing it to the model.
5. **RAG Detection** – For non-tool models we stringify the last user message and look for course-related keywords before running manual retrieval.
6. **Generation & Persistence** – We currently persist assistant messages for non-streaming requests by writing the `response.messages` entries back to `chat_messages`. (Streaming persistence can be added later by teeing the stream.)

## Client Expectations

- **Send only the newest user message** plus `chatId`; the API reconstructs the rest of the context internally.
- **Unique message IDs**: Reuse the same `message.id` when retrying a failed call so the server can safely ignore duplicates.
- **Handle 410**: If you receive `410 Gone` with `chatDeleted`, discard the stored `chatId` and start a new chat.
- **Proxy usage**: Only admin API key holders may include `proxyUser`. Always provide both `id` and `email` so we can autoprovision deterministic accounts.

## Email Semantics Recap

- `User.email` is the authoritative value for login/notifications.
- `ExternalUser.email` is informational, showing the latest email reported by the external provider. Updates here do not change the main user record automatically.
- To promote an external email into EduAI, update the `User` row directly (after verifying ownership).

## Future Considerations

- Persist assistant turns for streaming responses (requires buffering the final response/server-side tee).
- Expire or archive old `ChatMessage` rows if storage becomes an issue; the API would keep loading only the last N messages either way.
- Consider exposing an endpoint for clients to fetch past chat transcripts now that history lives server-side.
