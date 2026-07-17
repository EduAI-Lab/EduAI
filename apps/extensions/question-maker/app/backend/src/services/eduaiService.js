/**
 * Thin client around the EduAI API that powers chat, question generation, and catalog lookups.
 * Exposes a singleton so routes/services share configuration and connection state.
 */
import axios from "axios";
import { config } from "../config/settings.js";
import { logger } from "../utils/logger.js";

// Debug prefix for EduAI troubleshooting (grep for this to see all EduAI logs)
const DEBUG_PREFIX = "[EduAI]";

/**
 * Cloud providers we can probe for the connectivity badge, in preference order,
 * each paired with a lightweight probe model. Keys mirror the browser-stored
 * provider ids (see the frontend apiKeyStorage `CLOUD_PROVIDERS`).
 */
const CLOUD_PROBE_MODELS = {
  google: "google:gemini-2.5-flash",
  openai: "openai:gpt-4o-mini",
  deepseek: "deepseek:deepseek-chat",
  anthropic: "anthropic:claude-3-5-haiku-latest",
};

/** Strip ```json ... ``` / ``` ... ``` fences if the model wrapped its answer. */
function stripMarkdownJsonFence(raw) {
  const text = String(raw ?? "").trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : text;
}

/**
 * Extract the first balanced JSON array or object from text (string-aware).
 * Avoids the greedy /(\[[\s\S]*\]|\{[\s\S]*\})/ trap that matches markdown
 * citations like `[mr68fk2hgh…]` and then throws SyntaxError on JSON.parse.
 */
function extractBalancedJsonValue(text, openChar) {
  const closeChar = openChar === "[" ? "]" : "}";
  const start = text.indexOf(openChar);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === openChar) depth += 1;
    else if (c === closeChar) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function tryParseJson(s) {
  if (!s || typeof s !== "string") return null;
  try {
    return JSON.parse(s);
  } catch {
    try {
      return JSON.parse(s.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return null;
    }
  }
}

/**
 * Parse model output into a questions payload (array or wrapper object).
 * Returns null when nothing valid can be extracted — never throws on bad matches.
 */
function parseQuestionsPayloadFromText(raw) {
  const text = stripMarkdownJsonFence(raw);
  if (!text) return null;

  let parsed = tryParseJson(text);
  if (parsed != null) return parsed;

  // Scan every `[` / `{` start so CUID-like citations (`[mr68fk2hgh…]`) are
  // skipped when they fail to parse, and a later real JSON array still wins.
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== "[" && c !== "{") continue;
    const slice = extractBalancedJsonValue(text.slice(i), c);
    if (!slice) continue;
    parsed = tryParseJson(slice);
    if (parsed == null) continue;
    // Prefer question arrays; accept objects that wrap questions / error.
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return parsed;
  }

  return null;
}

class EduAIService {
  constructor() {
    this.baseURL = config.eduaiApiUrl;
    this.apiKey = config.eduaiApiKey;

    logger.info(
      {
        baseURL: this.baseURL,
        hasApiKey: !!this.apiKey,
        apiKeyLength: this.apiKey ? this.apiKey.length : 0,
      },
      "EduAI Service initialized"
    );

    if (!this.apiKey) {
      logger.warn(
        "EduAI API key not configured. EduAI features will be disabled."
      );
    }
  }

  /** Returns true when the Core/EduAI base URL is configured. */
  isConfigured() {
    return Boolean(this.baseURL);
  }

  /** True when a service API key is available (required for key-only endpoints). */
  hasApiKey() {
    return Boolean(this.apiKey?.trim());
  }

  /**
   * Builds auth headers for Core /api/chat.
   *
   * Prefer the caller's Core session cookie so generation runs as that user
   * (course access, audit, RBAC). Fall back to `Authorization: Bearer
   * <EDUAI_API_KEY>` only when no cookie is available (e.g. background jobs).
   * Do not send x-api-key — Core's chat route ignores it.
   */
  buildChatAuthHeaders(cookie) {
    const trimmedCookie = typeof cookie === "string" ? cookie.trim() : "";
    if (trimmedCookie) {
      return { cookie: trimmedCookie };
    }
    if (this.apiKey) {
      return { Authorization: `Bearer ${this.apiKey}` };
    }
    return null;
  }

  /**
   * Picks a lightweight model for connectivity checks. Prefers whichever cloud
   * provider the caller has a key for (browser-stored key), then the server's
   * Google key — so the badge reflects cloud availability for ANY supported cloud
   * provider, not just Google, even when the UBC-hosted (Ollama) provider is
   * offline. Falls back to Ollama only when no cloud key exists at all.
   *
   * `forceProvider` overrides the auto-selection so a caller can probe a specific
   * path regardless of what keys exist. The status chips rely on this: the UBC
   * chip must probe the UBC-hosted (Ollama) path even when a server Google key is
   * configured — otherwise the auto-selection would test Google and the UBC chip
   * would report Google's state, never its own.
   */
  getConnectivityTestParams(clientApiKeys = {}, forceProvider) {
    if (forceProvider === "ollama") {
      return {
        provider: "ollama",
        model: "ollama:gpt-oss:120b",
        apiKeys: { ollama: { isEnabled: true } },
      };
    }

    for (const provider of Object.keys(CLOUD_PROBE_MODELS)) {
      const clientKey = clientApiKeys?.[provider]?.apiKey?.trim?.();
      if (clientKey) {
        return {
          provider,
          model: CLOUD_PROBE_MODELS[provider],
          apiKeys: { [provider]: { apiKey: clientKey, isEnabled: true } },
        };
      }
    }

    // No client cloud key — fall back to the server-configured Google key if present.
    const serverGoogleKey = config.googleGenerativeAiApiKey?.trim();
    if (serverGoogleKey) {
      return {
        provider: "google",
        model: CLOUD_PROBE_MODELS.google,
        apiKeys: { google: { apiKey: serverGoogleKey, isEnabled: true } },
      };
    }

    return {
      provider: "ollama",
      model: "ollama:gpt-oss:120b",
      apiKeys: { ollama: { isEnabled: true } },
    };
  }

  /** Fills in server-side provider keys when the client did not supply one (local dev). */
  mergeApiKeysForModel(model, clientApiKeys = {}) {
    const merged = { ...(clientApiKeys || {}) };
    const provider = typeof model === "string" ? model.split(":")[0] : "";
    const googleKey = config.googleGenerativeAiApiKey?.trim();

    if (provider === "google" && googleKey && !merged.google?.apiKey?.trim()) {
      merged.google = { apiKey: googleKey, isEnabled: true };
    }
    if (provider === "ollama" && !merged.ollama) {
      merged.ollama = { isEnabled: true };
    }
    return merged;
  }

  /** Sends a chat payload to EduAI, handling logging, timeouts, and API error translation. */
  async chat(params) {
    const authHeaders = this.buildChatAuthHeaders(params.cookie);
    if (!authHeaders) {
      throw new Error(
        "EduAI chat requires a Core session. Sign in via Core, or set EDUAI_API_KEY for server-only calls."
      );
    }

    let chatStartMs;
    try {
      const model = params.model || "google:gemini-2.5-flash";
      // Core strips non-user roles from `messages` (ALLOWED_CLIENT_MESSAGE_ROLES).
      // System instructions must go in top-level `systemPrompt` or they are discarded
      // and Core falls back to the course-tutor persona (markdown prose, not JSON).
      const incoming = Array.isArray(params.messages) ? params.messages : [];
      const systemParts = incoming
        .filter((m) => m?.role === "system" && typeof m.content === "string" && m.content.trim())
        .map((m) => m.content.trim());
      const userMessages = incoming.filter((m) => m?.role === "user");
      const systemPrompt =
        (typeof params.systemPrompt === "string" && params.systemPrompt.trim()) ||
        systemParts.join("\n\n") ||
        undefined;

      const requestPayload = {
        messages: userMessages.length > 0 ? userMessages : incoming.filter((m) => m?.role !== "system"),
        model,
        apiKeys: this.mergeApiKeysForModel(model, params.apiKeys || {}),
        courseCode: params.courseCode,
        // Explicit false — `|| false` is fine, but avoid dropping a hard false later.
        streaming: params.streaming === true,
        ...(systemPrompt ? { systemPrompt } : {}),
      };

      // Allow caller to override (e.g. extraction needs longer than default 60s)
      const timeoutMs = params.timeoutMs != null && params.timeoutMs > 0 ? params.timeoutMs : 60000;
      chatStartMs = Date.now();
      console.log(`${DEBUG_PREFIX} chat request starting`, {
        url: `${this.baseURL}/api/chat`,
        timeoutMs,
        model: requestPayload.model,
        courseCode: requestPayload.courseCode,
        messageCount: (requestPayload.messages || []).length,
        hasSystemPrompt: Boolean(systemPrompt),
        systemPromptLength: systemPrompt?.length ?? 0,
        userPromptLength: (requestPayload.messages || []).find((m) => m.role === "user")?.content?.length ?? 0,
      });

      const response = await axios.post(
        `${this.baseURL}/api/chat`,
        requestPayload,
        {
          headers: {
            "Content-Type": "application/json",
            ...authHeaders,
          },
          timeout: timeoutMs,
        }
      );

      const elapsedMs = Date.now() - chatStartMs;
      const responseData = response.data;
      const responseKeys = responseData && typeof responseData === "object" ? Object.keys(responseData) : [];
      const contentPreview =
        responseData?.content != null
          ? String(responseData.content).slice(0, 200)
          : responseData?.message != null
            ? String(responseData.message).slice(0, 200)
            : "(no content/message)";
      console.log(`${DEBUG_PREFIX} chat response received`, {
        elapsedMs,
        status: response.status,
        responseKeys,
        contentLength: responseData?.content?.length ?? responseData?.message?.length ?? "n/a",
        contentPreview: contentPreview.length > 100 ? contentPreview + "..." : contentPreview,
      });

      return responseData;
    } catch (error) {
      if (error.response) {
        // API returned an error response
        const errorMessage =
          error.response.data?.error ||
          error.response.data?.message ||
          error.response.statusText;
        const statusCode = error.response.status;
        console.error("EduAI API Error:", {
          status: statusCode,
          statusText: error.response.statusText,
          data: error.response.data,
          url: `${this.baseURL}/api/chat`,
          headers: error.response.headers,
        });
        throw new Error(`EduAI API error (${statusCode}): ${errorMessage}`);
      } else if (error.request) {
        // Request was made but no response received – log enough to tell real timeout from other failures
        const elapsedMs = typeof chatStartMs === "number" ? Date.now() - chatStartMs : null;
        console.error(`${DEBUG_PREFIX} chat request failed (no response)`, {
          code: error.code,
          message: error.message,
          elapsedMs,
          configuredTimeoutMs: error.config?.timeout,
          isECONNABORTED: error.code === "ECONNABORTED",
          messageIncludesTimeout: (error.message || "").toLowerCase().includes("timeout"),
          url: error.config?.url,
          baseURL: error.config?.baseURL,
        });
        console.error("EduAI Request Error (full):", {
          request: error.request,
          message: error.message,
          code: error.code,
          config: {
            url: error.config?.url,
            method: error.config?.method,
            timeout: error.config?.timeout,
          }
        });
        
        // Provide more specific error messages based on error code
        const configuredTimeoutSec = error.config?.timeout != null ? Math.round(error.config.timeout / 1000) : 60;
        let errorMessage = "EduAI API request failed: No response received";
        if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
          errorMessage = `EduAI API request timed out after ${configuredTimeoutSec} seconds. The server may be slow or overloaded. Please try again.`;
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
          errorMessage = `EduAI API server is unreachable. Please check your network connection and verify the EduAI service URL (${this.baseURL}) is correct.`;
        } else if (error.code === 'ECONNRESET') {
          errorMessage = "EduAI API connection was reset. The server may have closed the connection. Please try again.";
        } else if (error.code) {
          errorMessage = `EduAI API request failed: ${error.code}. Please check your network connection and try again.`;
        }
        
        throw new Error(errorMessage);
      } else {
        // Something else happened
        console.error("EduAI Error:", error.message);
        throw new Error(`EduAI API error: ${error.message}`);
      }
    }
  }

  /** Generates normalized questions via EduAI, enforcing prompt requirements and parsing JSON responses. */
  async generateQuestions(params) {
    const {
      prompt,
      courseCode,
      model = "google:gemini-2.5-flash",
      apiKeys = {},
      numQuestions = 5,
      difficultyDistribution = { easy: 1, medium: 2, hard: 2 },
      reasoningDistribution = { factual: 40, analytical: 30, application: 30 },
      systemPromptOverride,
      userPromptOverride,
      mcqRequiredChoiceCount,
      cookie,
    } = params;

    if (!prompt || !courseCode) {
      throw new Error(
        "Prompt and courseCode are required for question generation"
      );
    }

    const mcqCountEnforced =
      typeof mcqRequiredChoiceCount === "number" &&
      Number.isInteger(mcqRequiredChoiceCount) &&
      mcqRequiredChoiceCount >= 2 &&
      mcqRequiredChoiceCount <= 26;

    const mcqChoiceCountLine = mcqCountEnforced
      ? `- "choices" is REQUIRED for MCQ: the array MUST contain exactly ${mcqRequiredChoiceCount} items (not ${mcqRequiredChoiceCount - 1} or ${mcqRequiredChoiceCount + 1}). Use consecutive letters ${Array.from({ length: mcqRequiredChoiceCount }, (_, i) => String.fromCharCode(65 + i)).join(", ")}. Each item: {"letter": "A", "text": "the option text"}.`
      : `- "choices" is REQUIRED: you MUST include a "choices" array with at least 2 items (typically 4). Each item: {"letter": "A", "text": "the option text"}.`;

    const defaultSystemPrompt = `You are an expert question generator for educational assessments. Generate exactly ${numQuestions} high-quality questions based on the course material.

Requirements:
- Generate exactly ${numQuestions} questions
- Difficulty distribution: Easy: ${difficultyDistribution.easy}, Medium: ${difficultyDistribution.medium}, Hard: ${difficultyDistribution.hard}
- Reasoning distribution: Factual: ${reasoningDistribution.factual}%, Analytical: ${reasoningDistribution.analytical}%, Application: ${reasoningDistribution.application}%
- Each question should be relevant to the course material
- For each question, you MUST generate a correct answer based on the question content

Format each question as a JSON object with these exact fields:
  {
    "content": "The question text only (for MCQ: do NOT include choices in content)",
    "description": "Brief summary (<= 15 words) that does not simply repeat the question text",
    "difficulty": "easy/medium/hard",
    "reasoning_level": "factual/analytical/application",
    "type": "MCQ/SA/LA",
    "answer": "The correct answer (see guidelines below)",
    "primary_topic_id": number | null,
    "secondary_topic_ids": number[],
    "choices": [{"letter": "A", "text": "Option A"}, ...]  // REQUIRED for MCQ questions only
  }

IMPORTANT FOR MCQ QUESTIONS:
- "content" must contain ONLY the question text, without any choices. Do NOT put options inside content.
${mcqChoiceCountLine}
- Each choice must have a unique letter (A, B, C, D, E, etc.). Never omit "choices" for MCQ.
- "answer" must be the single letter of the correct choice (e.g., "B").
${mcqCountEnforced ? `- For this request, if type is MCQ, violating the exact choice count is an error — match the source question's option count.\n` : ""}

Answer Guidelines:
- For MCQ questions: "answer" must be the letter of the correct choice (e.g., "A", "B", "C", "D")
- For SA (Short Answer) questions: Provide a concise, accurate answer (1-3 sentences) in the "answer" field
- For LA (Long Answer) questions: Provide a comprehensive, detailed answer that fully addresses the question in the "answer" field
- The answer must be accurate and directly address the question content
- Do not leave answers as null or empty - always generate a valid answer

If the user prompt includes a "Course topics" section, use those numeric IDs exactly when setting primary_topic_id and secondary_topic_ids.

ERROR HANDLING:
If you are unable to generate the requested question(s) for any reason (e.g., insufficient information, ambiguous prompt, topic not covered in course material, conflicting requirements), you MUST return a JSON object with this exact format instead of a question array:
{
  "error": true,
  "reason": "A clear, detailed explanation of why you could not generate the question. Be specific about what is missing, unclear, or problematic in the request."
}

IMPORTANT: 
- If you can generate the question(s), return ONLY a valid JSON array of question objects. Do NOT wrap the array in an object (e.g. do not use {"questions": [...]}). Return the array directly, e.g. [{...}, {...}]. No other text, no markdown, no code fence.
- If you cannot generate the question(s), return ONLY the error object above. No other text.`;

    const defaultUserPrompt = `Generate questions about: ${prompt}

Please ensure the questions are appropriate for the course level and cover the key concepts comprehensively.

OUTPUT RULES (mandatory):
- Reply with ONLY a JSON array of question objects (or {"error":true,"reason":"..."}).
- No markdown, no code fences, no headings, no commentary before or after the JSON.`;

    const systemPrompt = systemPromptOverride ?? defaultSystemPrompt;
    const userPrompt = userPromptOverride ?? defaultUserPrompt;

    try {
      const genStartMs = Date.now();
      console.log(`${DEBUG_PREFIX} generateQuestions calling chat`, {
        courseCode,
        model,
        numQuestions,
        mcqRequiredChoiceCount: mcqCountEnforced ? mcqRequiredChoiceCount : undefined,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
        usingOverrides: Boolean(systemPromptOverride || userPromptOverride),
      });

      // Extraction/generation can take longer than default 60s (large prompts, multiple questions)
      const response = await this.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        model,
        apiKeys,
        courseCode,
        streaming: false,
        timeoutMs: 180000, // 3 minutes for question generation/extraction
        cookie,
      });

      const genElapsedMs = Date.now() - genStartMs;
      const rawContent = response?.content ?? response?.message ?? response;
      const rawType = rawContent == null ? "null" : typeof rawContent;
      const rawLength = typeof rawContent === "string" ? rawContent.length : "n/a";
      console.log(`${DEBUG_PREFIX} generateQuestions chat returned`, {
        genElapsedMs,
        responseKeys: response && typeof response === "object" ? Object.keys(response) : [],
        rawContentType: rawType,
        rawContentLength: rawLength,
        rawContentPreview: typeof rawContent === "string" ? rawContent.slice(0, 150) + (rawContent.length > 150 ? "..." : "") : String(rawContent).slice(0, 150),
      });

      // Parse the response (EduAI may return string JSON, fenced markdown, or prose + JSON)
      const rawPayload = response?.content ?? response?.message ?? response;
      let parsedResponse;
      if (rawPayload !== null && typeof rawPayload === "object") {
        parsedResponse = rawPayload;
        console.log(`${DEBUG_PREFIX} generateQuestions using pre-parsed response`, {
          isArray: Array.isArray(rawPayload),
          keys: Array.isArray(rawPayload) ? "array" : Object.keys(rawPayload || {}),
        });
      } else {
        const str = typeof rawPayload === "string" ? rawPayload : String(rawPayload ?? "");
        parsedResponse = parseQuestionsPayloadFromText(str);
        if (parsedResponse == null) {
          console.warn(`${DEBUG_PREFIX} generateQuestions first parse failed; retrying with JSON-only repair`, {
            rawPreview: str.slice(0, 300),
          });
          const repairSystem = `${systemPrompt}

CRITICAL: Your previous reply was not valid JSON. Reply with ONLY a JSON array of question objects (or {"error":true,"reason":"..."}). No markdown, no code fences, no prose before or after the JSON.`;
          const repairResponse = await this.chat({
            messages: [
              { role: "system", content: repairSystem },
              { role: "user", content: userPrompt },
            ],
            model,
            apiKeys,
            courseCode,
            streaming: false,
            timeoutMs: 180000,
            cookie,
          });
          const repairRaw =
            repairResponse?.content ?? repairResponse?.message ?? repairResponse;
          if (repairRaw !== null && typeof repairRaw === "object") {
            parsedResponse = repairRaw;
          } else {
            parsedResponse = parseQuestionsPayloadFromText(
              typeof repairRaw === "string" ? repairRaw : String(repairRaw ?? ""),
            );
          }
          if (parsedResponse == null) {
            console.error(`${DEBUG_PREFIX} generateQuestions JSON parse failed after retry`, {
              rawType: typeof rawPayload,
              rawPreview: str.slice(0, 300),
              repairPreview: String(repairRaw ?? "").slice(0, 300),
            });
            throw new Error(
              "Could not parse response from EduAI (expected a JSON array of questions)",
            );
          }
        }
      }

      // Check if the response is an error object
      if (parsedResponse && typeof parsedResponse === 'object' && parsedResponse.error === true) {
        const errorReason = parsedResponse.reason || "AI was unable to generate the question";
        throw new Error(errorReason);
      }

      // Accept raw array or unwrap from common wrapper keys (EduAI/LLM may return { questions: [...] } or { data: [...] })
      let questions = null;
      if (Array.isArray(parsedResponse)) {
        questions = parsedResponse;
      } else if (parsedResponse && typeof parsedResponse === 'object') {
        questions =
          parsedResponse.questions ??
          parsedResponse.data ??
          parsedResponse.results ??
          (() => {
            const firstArray = Object.values(parsedResponse).find((v) => Array.isArray(v));
            return firstArray ?? null;
          })();
      }

      if (!Array.isArray(questions)) {
        throw new Error(
          "EduAI response is not an array of questions. Expected a JSON array of question objects (or an object with a 'questions' array)."
        );
      }

      // Normalize missing fields (extraction often omits reasoning_level; default instead of dropping)
      const questionsNormalized = questions
        .filter((q) => q && typeof q === "object" && typeof q.content === "string" && q.content.trim())
        .map((q) => {
          const difficulty = ["easy", "medium", "hard"].includes(q.difficulty)
            ? q.difficulty
            : "medium";
          const rlRaw = q.reasoning_level ?? q.reasoningLevel;
          const reasoning_level = ["factual", "analytical", "application"].includes(rlRaw)
            ? rlRaw
            : "factual";
          return { ...q, content: q.content.trim(), difficulty, reasoning_level };
        });

      const validQuestions = questionsNormalized.filter(
        (q) =>
          q.content &&
          q.difficulty &&
          q.reasoning_level &&
          ["easy", "medium", "hard"].includes(q.difficulty) &&
          ["factual", "analytical", "application"].includes(q.reasoning_level)
      );

      if (validQuestions.length === 0) {
        throw new Error("No valid questions found in EduAI response");
      }

      /** Parse MCQ choices from content when model embeds "A) ... B) ..." in content. Returns { questionText, choices }. */
      const parseChoicesFromContent = (text) => {
        if (!text || typeof text !== "string") return { questionText: text || "", choices: [] };
        const lines = text.split("\n");
        const choices = [];
        const questionLines = [];
        const choicePattern = /^([A-Za-z])\)\s*(.+)$/;
        let foundChoices = false;
        for (const line of lines) {
          const trimmed = line.trim();
          const match = trimmed.match(choicePattern);
          if (match) {
            foundChoices = true;
            choices.push({ letter: match[1].toUpperCase(), text: match[2].trim() });
          } else if (trimmed && !foundChoices) {
            questionLines.push(line);
          }
        }
        const questionText = questionLines.join("\n").trim() || text;
        return { questionText, choices };
      };

      const normalizedQuestions = validQuestions.map((question, index) => {
        console.log(`${DEBUG_PREFIX} raw question ${index + 1}`, {
          type: question.type,
          choicesLength: Array.isArray(question.choices) ? question.choices.length : "not array",
          contentLength: question.content?.length ?? 0,
        });

        let content = question.content.trim();

        const description =
          typeof question.description === "string" &&
          question.description.trim().length > 0
            ? question.description.trim()
            : "";

        const primaryCandidate = Number(question.primary_topic_id);
        const primaryTopicId = Number.isInteger(primaryCandidate)
          ? primaryCandidate
          : null;

        const secondaryTopicIds = Array.isArray(question.secondary_topic_ids)
          ? Array.from(
              new Set(
                question.secondary_topic_ids
                  .map((value) => Number(value))
                  .filter(
                    (value) =>
                      Number.isInteger(value) && value !== primaryTopicId
                  )
              )
            )
          : [];

        const questionType =
          typeof question.type === "string" &&
          question.type.toUpperCase().trim() === "SA"
            ? "SA"
            : typeof question.type === "string" &&
              question.type.toUpperCase().trim() === "LA"
              ? "LA"
              : "MCQ";

        // Handle choices for MCQ questions
        let choices = null;
        let answer = null;

        if (questionType === "MCQ") {
          // Normalize choices: accept array of {letter, text} or object like { "A": "text", "B": "text" }
          let rawChoices = question.choices;
          if (rawChoices !== null && typeof rawChoices === "object" && !Array.isArray(rawChoices)) {
            rawChoices = Object.entries(rawChoices).map(([letter, text]) => ({
              letter: String(letter).trim().toUpperCase() || null,
              text: typeof text === "string" ? text.trim() : String(text || ""),
            })).filter((c) => c.letter && c.text);
          }
          if (Array.isArray(rawChoices) && rawChoices.length > 0) {
            choices = rawChoices
              .map((choice) => {
                if (typeof choice === "object" && choice !== null) {
                  const letter = typeof choice.letter === "string"
                    ? choice.letter.toUpperCase().trim()
                    : null;
                  const text = typeof choice.text === "string"
                    ? choice.text.trim()
                    : "";

                  if (letter && text) {
                    return { letter, text };
                  }
                }
                return null;
              })
              .filter((choice) => choice !== null);

            // Ensure unique letters
            const seenLetters = new Set();
            choices = choices.filter((choice) => {
              if (seenLetters.has(choice.letter)) {
                return false;
              }
              seenLetters.add(choice.letter);
              return true;
            });
          }

          // Fallback 1: model may omit "choices" or embed them in content (e.g. "Question?\nA) ...\nB) ...")
          if ((!choices || choices.length === 0) && content) {
            const parsed = parseChoicesFromContent(content);
            if (parsed.choices.length >= 2) {
              content = parsed.questionText;
              choices = parsed.choices;
              console.log(`${DEBUG_PREFIX} MCQ choices parsed from content`, { count: choices.length });
            }
          }

          // Fallback 2: model returned MCQ but no choices – use placeholders so user can edit
          if (!choices || choices.length === 0) {
            if (mcqCountEnforced) {
              choices = [];
              console.log(`${DEBUG_PREFIX} MCQ had no choices; leaving empty (strict choice count — caller must retry)`);
            } else {
              choices = [
                { letter: "A", text: "Option A" },
                { letter: "B", text: "Option B" },
                { letter: "C", text: "Option C" },
                { letter: "D", text: "Option D" },
              ];
              console.log(`${DEBUG_PREFIX} MCQ had no choices; using placeholders`);
            }
          }

          // Normalize answer to just the letter for MCQ
          if (typeof question.answer === "string" && question.answer.trim().length > 0) {
            const answerText = question.answer.trim();
            // Extract letter from formats like "B", "B)", "B) Option B", etc.
            const letterMatch = answerText.match(/^([A-Za-z])/);
            answer = letterMatch ? letterMatch[1].toUpperCase() : answerText;
          }
        } else {
          // For SA/LA, keep full answer text
          answer =
            typeof question.answer === "string" && question.answer.trim().length > 0
              ? question.answer.trim()
              : null;
        }

        return {
          content,
          description,
          difficulty: question.difficulty,
          reasoning_level: question.reasoning_level,
          type: questionType,
          answer,
          choices, // Will be null for SA/LA, array for MCQ
          primary_topic_id: primaryTopicId,
          secondary_topic_ids: secondaryTopicIds,
        };
      });

      console.log(`${DEBUG_PREFIX} generateQuestions success`, { count: normalizedQuestions.length });
      return normalizedQuestions;
    } catch (error) {
      console.error(`${DEBUG_PREFIX} generateQuestions failed`, {
        message: error.message,
        name: error.name,
        code: error?.code,
      });
      throw new Error(`EduAI question generation failed: ${error.message}`);
    }
  }

  /** Lists EduAI-managed courses for onboarding flows. Excludes courses in config.eduaiIgnoredCourseCodes. */
  async listCourses() {
    if (!this.isConfigured() || !this.hasApiKey()) {
      throw new Error(
        "EduAI service is not configured. Please set EDUAI_API_KEY environment variable."
      );
    }

    const url = `${this.baseURL}/api/courses`;

    try {
      const response = await axios.get(url, {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        timeout: 60000, // 60 second timeout
      });

      const data = response.data;
      const ignored = (config.eduaiIgnoredCourseCodes || []).map((c) =>
        String(c).replace(/\s+/g, "").toLowerCase()
      );
      if (ignored.length === 0) {
        return data;
      }

      const normalize = (v) => (v == null ? "" : String(v).replace(/\s+/g, "").toLowerCase());
      const filterCourse = (course) => {
        const code = normalize(course.code);
        const id = normalize(course.id);
        return !ignored.some((k) => code === k || id === k);
      };

      if (Array.isArray(data)) {
        return data.filter(filterCourse);
      }
      if (data && Array.isArray(data.courses)) {
        return { ...data, courses: data.courses.filter(filterCourse) };
      }
      return data;
    } catch (error) {
      if (error.response) {
        const errorMessage =
          error.response.data?.error ||
          error.response.data?.message ||
          error.response.statusText;
        const statusCode = error.response.status;
        console.error("EduAI courses API error:", {
          status: statusCode,
          statusText: error.response.statusText,
          data: error.response.data,
          url,
        });
        throw new Error(`EduAI API error (${statusCode}): ${errorMessage}`);
      } else if (error.request) {
        console.error("EduAI courses request error:", error.request);
        throw new Error("EduAI API request failed: No response received");
      } else {
        console.error("EduAI courses error:", error.message);
        throw new Error(`EduAI API error: ${error.message}`);
      }
    }
  }

  /** Fetches topic metadata for an EduAI course identifier. */
  async getCourseTopics(courseId) {
    if (!this.isConfigured() || !this.hasApiKey()) {
      throw new Error(
        "EduAI service is not configured. Please set EDUAI_API_KEY environment variable."
      );
    }

    if (!courseId) {
      throw new Error("courseId is required to fetch EduAI topics");
    }

    const url = `${this.baseURL}/api/courses/${courseId}/topics`;

    try {
      const response = await axios.get(url, {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        timeout: 60000, // 60 second timeout
      });

      return response.data;
    } catch (error) {
      if (error.response) {
        const errorMessage =
          error.response.data?.error ||
          error.response.data?.message ||
          error.response.statusText;
        const statusCode = error.response.status;
        console.error("EduAI topics API error:", {
          status: statusCode,
          statusText: error.response.statusText,
          data: error.response.data,
          url,
        });
        throw new Error(`EduAI API error (${statusCode}): ${errorMessage}`);
      } else if (error.request) {
        console.error("EduAI topics request error:", error.request);
        throw new Error("EduAI API request failed: No response received");
      } else {
        console.error("EduAI topics error:", error.message);
        throw new Error(`EduAI API error: ${error.message}`);
      }
    }
  }

  _coreHeaders() {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
    };
  }

  _assertConfigured() {
    if (!this.isConfigured()) {
      throw new Error(
        "EduAI service is not configured. Please set EDUAI_API_KEY environment variable."
      );
    }
  }

  async listQuestionBanks(coreCourseId) {
    this._assertConfigured();
    const url = `${this.baseURL}/api/courses/${coreCourseId}/banks`;
    const response = await axios.get(url, {
      headers: this._coreHeaders(),
      timeout: 60000,
    });
    return response.data;
  }

  async createQuestionBank(coreCourseId, payload) {
    this._assertConfigured();
    const url = `${this.baseURL}/api/courses/${coreCourseId}/banks`;
    const response = await axios.post(url, payload, {
      headers: this._coreHeaders(),
      timeout: 60000,
    });
    return response.data;
  }

  async updateQuestionBank(coreCourseId, bankId, payload) {
    this._assertConfigured();
    const url = `${this.baseURL}/api/courses/${coreCourseId}/banks/${bankId}`;
    const response = await axios.put(url, payload, {
      headers: this._coreHeaders(),
      timeout: 60000,
    });
    return response.data;
  }

  async deleteQuestionBank(coreCourseId, bankId, payload = {}) {
    this._assertConfigured();
    const url = `${this.baseURL}/api/courses/${coreCourseId}/banks/${bankId}`;
    const response = await axios.delete(url, {
      headers: this._coreHeaders(),
      data: payload,
      timeout: 60000,
    });
    return response.data;
  }

  async listQuestionBankMemberships(coreCourseId, bankId) {
    this._assertConfigured();
    const url = `${this.baseURL}/api/courses/${coreCourseId}/banks/${bankId}/questions`;
    const response = await axios.get(url, {
      headers: this._coreHeaders(),
      timeout: 60000,
    });
    return response.data;
  }

  async addQuestionBankMembership(coreCourseId, bankId, payload) {
    this._assertConfigured();
    const url = `${this.baseURL}/api/courses/${coreCourseId}/banks/${bankId}/questions`;
    const response = await axios.post(url, payload, {
      headers: this._coreHeaders(),
      timeout: 60000,
    });
    return response.data;
  }

  async removeQuestionBankMembership(
    coreCourseId,
    bankId,
    externalQuestionId,
    source = "question-maker"
  ) {
    this._assertConfigured();
    const url = `${this.baseURL}/api/courses/${coreCourseId}/banks/${bankId}/questions/${externalQuestionId}?source=${encodeURIComponent(source)}`;
    const response = await axios.delete(url, {
      headers: this._coreHeaders(),
      timeout: 60000,
    });
    return response.data;
  }

  /** Retrieves the list of AI models supported by EduAI for display in pickers. */
  async listAIModels({ cookie } = {}) {
    if (!this.isConfigured() && !cookie?.trim()) {
      throw new Error(
        "EduAI service is not configured. Please set EDUAI_API_KEY environment variable."
      );
    }

    const url = `${this.baseURL}/api/ai-models`;
    const headerVariants = [];
    const trimmedCookie = typeof cookie === "string" ? cookie.trim() : "";
    if (trimmedCookie) {
      headerVariants.push({ cookie: trimmedCookie });
    }
    if (this.apiKey) {
      headerVariants.push({ "x-api-key": this.apiKey });
      headerVariants.push({ Authorization: `Bearer ${this.apiKey}` });
    }

    let lastError;
    for (const authHeaders of headerVariants) {
      try {
        const response = await axios.get(url, {
          headers: {
            "Content-Type": "application/json",
            ...authHeaders,
          },
          timeout: 60000,
        });
        return response.data;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError?.response) {
      const errorMessage =
        lastError.response.data?.error ||
        lastError.response.data?.message ||
        lastError.response.statusText;
      const statusCode = lastError.response.status;
      console.error("EduAI AI models API error:", {
        status: statusCode,
        statusText: lastError.response.statusText,
        data: lastError.response.data,
        url,
      });
      throw new Error(`EduAI API error (${statusCode}): ${errorMessage}`);
    } else if (lastError?.request) {
      console.error("EduAI AI models request error:", lastError.request);
      throw new Error("EduAI API request failed: No response received");
    } else if (lastError) {
      console.error("EduAI AI models error:", lastError.message);
      throw new Error(`EduAI API error: ${lastError.message}`);
    }

    throw new Error(
      "EduAI service is not configured. Please set EDUAI_API_KEY environment variable."
    );
  }

  /**
   * Issues a lightweight chat call to validate Core AI connectivity.
   * `apiKeys` carries any browser-stored provider keys (e.g. the user's Google
   * key) so the check can validate the cloud provider rather than always testing
   * the (possibly offline) UBC-hosted provider. `provider` is echoed back so the
   * UI can tell the user which path is live. `forceProvider` pins the probe to a
   * specific path (e.g. `'ollama'` for the independent UBC status chip).
   */
  async testApiKey({ cookie, apiKeys: clientApiKeys = {}, forceProvider } = {}) {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: "EduAI base URL not configured (EDUAI_API_URL)",
      };
    }

    if (!cookie?.trim() && !this.apiKey) {
      return {
        success: false,
        error: "Sign in via Core to use AI (session cookie required)",
      };
    }

    const { provider, model, apiKeys } = this.getConnectivityTestParams(clientApiKeys, forceProvider);
    try {
      const response = await this.chat({
        messages: [{ role: "user", content: "test" }],
        model,
        apiKeys,
        courseCode: "COSC 121",
        streaming: false,
        cookie,
      });

      return {
        success: true,
        message: cookie?.trim() ? "Core session can reach AI" : "Service key can reach AI",
        provider,
        response: response,
      };
    } catch (error) {
      if (
        error.message.includes("401") ||
        error.message.includes("Unauthorized")
      ) {
        return {
          success: false,
          error: "AI authentication failed — sign in via Core again",
        };
      } else if (
        error.message.includes("403") ||
        error.message.includes("Forbidden")
      ) {
        return {
          success: false,
          error: "AI access forbidden for this session",
        };
      } else if (
        error.message.includes("Invalid API key") ||
        error.message.includes("test-key")
      ) {
        return {
          success: true,
          message:
            "EduAI API key is valid (provider API key test failed as expected)",
          note: "The EduAI API key works, but you need to provide valid AI provider API keys",
        };
      } else {
        return {
          success: false,
          provider,
          error: `API key test failed: ${error.message}`,
          statusCode: error.response?.status,
        };
      }
    }
  }
}

// Export singleton instance
export const eduaiService = new EduAIService();
export default eduaiService;

