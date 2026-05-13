# EduAICore Tests

Planned test cases for `apps/core`. All tests live under `app/__tests__/` and are run with Vitest.

---

## Assigned to: Ye

### `lib/utils.test.ts`

**`cn()`**
- Merges multiple class name strings into one
- Resolves Tailwind conflicts — last conflicting class wins (e.g. `bg-red-500 bg-blue-500` → `bg-blue-500`)
- Ignores falsy values (`undefined`, `null`, `false`, `0`)
- Handles conditional classes via object syntax (`{ 'text-red-500': true, 'text-blue-500': false }`)
- Returns an empty string when called with no arguments

---

### `lib/ai/providers.test.ts`

**`PROVIDER_CONFIGS`**
- Contains exactly three entries: `openai`, `google`, `ollama`
- Ollama is the only provider with `requiresApiKey: false`

**`validateProviderConfig()`**
- Returns `{ isValid: false }` for an unknown provider ID
- Returns `{ isValid: false }` for OpenAI with no API key
- Returns `{ isValid: false }` for Google with no API key
- Returns `{ isValid: true }` for Ollama with no API key (key not required)
- Returns `{ isValid: true }` for OpenAI with a valid API key

**`parseModelIdentifier()`**
- Returns `null` for an empty string
- Returns `null` for a string with no colon
- Returns `null` for an unknown provider prefix (e.g. `anthropic:claude-3`)
- Returns `null` when the provider segment is empty (e.g. `:gpt-4`)
- Returns `null` when the model segment is empty (e.g. `openai:`)
- Correctly parses `openai:gpt-4o` → `{ providerId: 'openai', modelId: 'gpt-4o' }`
- Correctly parses `ollama:llama3:8b` → `{ providerId: 'ollama', modelId: 'llama3:8b' }` (colons in modelId are preserved)

**`getModelIdentifier()`**
- Returns `"openai:gpt-4o"` for `('openai', 'gpt-4o')`
- Returns `"ollama:llama3:8b"` for `('ollama', 'llama3:8b')`

**`getAvailableProviders()`**
- Returns an array of exactly three provider configs
- Each entry has `id`, `name`, `description`, and `requiresApiKey`

**`getProviderConfig()`**
- Returns the correct config object for each valid provider ID
- Returns `null` for an unknown provider ID

**`isProviderConfigured()`**
- Returns `false` when `isEnabled` is `false`, regardless of API key
- Returns `false` for OpenAI when enabled but `apiKey` is absent or empty
- Returns `false` for Google when enabled but `apiKey` is absent or empty
- Returns `true` for OpenAI when enabled with a non-empty `apiKey`
- Returns `true` for Ollama when enabled, with or without a `baseUrl`

---

## Assigned to: Ehsan

### `lib/ai/file-processing.test.ts`

**`sanitizeTextContent()`**
- Removes null bytes (`\0`)
- Removes control characters in ranges `\x01–\x08`, `\x0B–\x0C`, `\x0E–\x1F`, `\x7F`
- Preserves newlines (`\n`), carriage returns used with newlines (`\r\n` → `\n`), and tabs
- Normalises standalone `\r` to `\n`
- Collapses three or more consecutive newlines down to two
- Trims leading and trailing whitespace
- Returns an empty string for an empty input

**`generateChecksum()`**
- Returns a 64-character lowercase hex string (SHA-256)
- Returns the same value for the same input on repeated calls
- Returns different values for different inputs

**`validateFile()`**
- Accepts `text/plain`, `text/markdown`, `application/pdf`, DOCX, and PPTX MIME types
- Rejects any other MIME type with an error message naming the unsupported type
- Rejects files larger than 50 MB with an appropriate error message
- Accepts files exactly at the 50 MB boundary

**`applySemanticChunking()`**
- Returns an empty array for an empty string
- Returns a single chunk for content shorter than `maxChunkSize`
- Detects markdown (presence of `# `, `## `, or `### `) and uses the markdown path
- Splits markdown content at major heading boundaries before the size limit is hit
- Falls back to paragraph-based splitting for non-markdown content
- No returned chunk exceeds `maxChunkSize` characters (within a reasonable margin for forced splits)
- Filters out empty/whitespace-only chunks

**`extractTextFromFile()`**
- Strips the file extension from `file.name` to produce `title`
- Returns the correct `mimeType` and `fileSize` from the file object
- Sanitizes content before computing the checksum
- The returned `checksum` matches `generateChecksum()` called on the sanitized content

---

### `lib/ai/embedding.test.ts`

**`generateChunks()`**
- Returns an empty array for an empty string
- Returns a single chunk when content is shorter than `maxChunkSize`
- No chunk in the output exceeds `maxChunkSize` characters
- Overlap is applied: the start of chunk N+1 shares words with the end of chunk N
- Handles content with no sentence-ending punctuation without throwing
- Trims whitespace from each chunk

---

### `lib/courses/schemas.test.ts`

**`CreateCourseSchema`**
- Passes for a fully valid object with `name`, `code`, `term`, `year`, and `aiInstructions`
- Passes with `aiInstructions` omitted (defaults to `""`)
- Fails when `name` is an empty string
- Fails when `code` is an empty string
- Fails when `term` is an empty string
- Fails when `year` is not an integer (e.g. `2024.5`)

**`UpdateCourseSchema`**
- Passes for an empty object (all fields optional)
- Passes for a partial object (e.g. only `name`)
- Fails when a provided field fails its own constraint (e.g. `name: ""`)

**`CreateCourseTopicSchema`**
- Passes for `{ name: "Week 1" }`
- Fails when `name` is an empty string

**`DeleteCourseTopicSchema`**
- Passes when only `topicId` is provided
- Passes when only `name` is provided
- Fails when both `topicId` and `name` are omitted (refine rule)

---

## Assigned to: Al-Ameen

### `lib/ai/schemas.test.ts`

**`CreateAIProviderSchema`**
- Passes for a fully valid object
- Fails when `name`, `displayName`, or `description` is an empty string
- Fails when `defaultBaseUrl` is present but not a valid URL
- Defaults `requiresApiKey` to `true` and `isActive` to `true` when omitted

**`UpdateAIProviderSchema`**
- Passes for an empty object (all fields optional)
- Fails when `defaultBaseUrl` is present but not a valid URL

**`CreateAIModelSchema`**
- Passes for a fully valid object
- Fails when `type` is not one of the allowed enum values
- Fails when `inputPricing` or `outputPricing` is negative
- Fails when `providerId` is an empty string
- Defaults `supportsImages`, `supportsTools` to `false` and `supportsStreaming`, `isActive` to `true`

**`UpdateAIModelSchema`**
- Passes for an empty object (all fields optional)
- Fails when a provided field fails its own constraint

---

### `components/LoginForm.test.tsx`

**Rendering**
- Renders an email input with `type="email"`
- Renders a password input with `type="password"`
- Renders the submit button with the text "Login"
- Renders a "Login with GitHub" button
- Renders a link to `/auth/register`

**Field errors**
- Displays the email error message when `fieldErrors.email` is set
- Applies the error border class to the email input when `fieldErrors.email` is set
- Displays the password error message when `fieldErrors.password` is set

**Loading state**
- Disables the email input when `isLoading` is `true`
- Disables the password input when `isLoading` is `true`
- Disables the submit button when `isLoading` is `true`
- Changes the submit button text to "Signing in..." when `isLoading` is `true`

---

### `components/RegisterForm.test.tsx`

**Rendering**
- Renders name, email, password, and confirm-password inputs
- Renders the submit button with the text "Register"
- Renders a "Register with GitHub" button
- Renders a link to `/auth/login`

**Field errors**
- Displays and applies error styling for `fieldErrors.name`
- Displays and applies error styling for `fieldErrors.email`
- Displays and applies error styling for `fieldErrors.password`
- Displays and applies error styling for `fieldErrors.confirmPassword`

**Loading state**
- Disables all four inputs when `isLoading` is `true`
- Disables the submit button when `isLoading` is `true`
- Changes the submit button text to "Creating account..." when `isLoading` is `true`
