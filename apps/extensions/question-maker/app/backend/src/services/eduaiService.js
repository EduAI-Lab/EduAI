/**
 * Thin client around the EduAI API that powers chat, question generation, and catalog lookups.
 * Exposes a singleton so routes/services share configuration and connection state.
 */
import axios from "axios";
import { config } from "../config/settings.js";

// Debug prefix for EduAI troubleshooting (grep for this to see all EduAI logs)
const DEBUG_PREFIX = "[EduAI]";

class EduAIService {
  constructor() {
    this.baseURL = config.eduaiApiUrl;
    this.apiKey = config.eduaiApiKey;

    console.log("EduAI Service initialized:", {
      baseURL: this.baseURL,
      hasApiKey: !!this.apiKey,
      apiKeyLength: this.apiKey ? this.apiKey.length : 0,
      apiKeyPrefix: this.apiKey ? this.apiKey.substring(0, 8) + "..." : "none",
    });

    if (!this.apiKey) {
      console.warn(
        "EduAI API key not configured. EduAI features will be disabled."
      );
    }
  }

  /** Returns true when the base URL/API key are available and the service can make requests. */
  isConfigured() {
    return !!this.apiKey;
  }

  /** Sends a chat payload to EduAI, handling logging, timeouts, and API error translation. */
  async chat(params) {
    if (!this.isConfigured()) {
      throw new Error(
        "EduAI service is not configured. Please set EDUAI_API_KEY environment variable."
      );
    }

    let chatStartMs;
    try {
      const requestPayload = {
        messages: params.messages || [],
        model: params.model || "google:gemini-2.5-flash",
        apiKeys: params.apiKeys || {},
        courseCode: params.courseCode,
        streaming: params.streaming || false,
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
        systemPromptLength: (requestPayload.messages || []).find((m) => m.role === "system")?.content?.length ?? 0,
        userPromptLength: (requestPayload.messages || []).find((m) => m.role === "user")?.content?.length ?? 0,
      });

      const response = await axios.post(
        `${this.baseURL}/api/chat`,
        requestPayload,
        {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
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

Please ensure the questions are appropriate for the course level and cover the key concepts comprehensively.`;

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

      // Parse the response (EduAI may return string JSON or already-parsed array/object)
      const rawPayload = response?.content ?? response?.message ?? response;
      let parsedResponse;
      if (rawPayload !== null && typeof rawPayload === "object") {
        // Already an object or array – use as-is to avoid JSON.parse(non-string) throwing (e.g. "array" / .match errors)
        parsedResponse = rawPayload;
        console.log(`${DEBUG_PREFIX} generateQuestions using pre-parsed response`, {
          isArray: Array.isArray(rawPayload),
          keys: Array.isArray(rawPayload) ? "array" : Object.keys(rawPayload || {}),
        });
      } else {
        try {
          const str = typeof rawPayload === "string" ? rawPayload : String(rawPayload);
          parsedResponse = JSON.parse(str);
        } catch (parseError) {
          const str = typeof rawPayload === "string" ? rawPayload : String(rawPayload);
          const jsonMatch = str.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
          if (jsonMatch) {
            parsedResponse = JSON.parse(jsonMatch[0]);
          } else {
            console.error(`${DEBUG_PREFIX} generateQuestions JSON parse failed`, {
              parseError: parseError?.message,
              rawType: typeof rawPayload,
              rawPreview: str?.slice?.(0, 300),
            });
            throw new Error("Could not parse response from EduAI");
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
    if (!this.isConfigured()) {
      throw new Error(
        "EduAI service is not configured. Please set EDUAI_API_KEY environment variable."
      );
    }

    const url = `${this.baseURL}/api/courses`;

    try {
      const response = await axios.get(url, {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
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
    if (!this.isConfigured()) {
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
          "x-api-key": this.apiKey,
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

  /** Retrieves the list of AI models supported by EduAI for display in pickers. */
  async listAIModels() {
    if (!this.isConfigured()) {
      throw new Error(
        "EduAI service is not configured. Please set EDUAI_API_KEY environment variable."
      );
    }

    const url = `${this.baseURL}/api/ai-models`;

    try {
      const response = await axios.get(url, {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
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
        console.error("EduAI AI models API error:", {
          status: statusCode,
          statusText: error.response.statusText,
          data: error.response.data,
          url,
        });
        throw new Error(`EduAI API error (${statusCode}): ${errorMessage}`);
      } else if (error.request) {
        console.error("EduAI AI models request error:", error.request);
        throw new Error("EduAI API request failed: No response received");
      } else {
        console.error("EduAI AI models error:", error.message);
        throw new Error(`EduAI API error: ${error.message}`);
      }
    }
  }

  /** Issues a lightweight chat call to validate whether the configured EduAI API key works. */
  async testApiKey() {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: "EduAI API key not configured",
      };
    }

    try {
      // Test the API key by making a minimal chat request with Ollama
      const response = await this.chat({
        messages: [{ role: "user", content: "test" }],
        model: "ollama:gpt-oss:120b", // Use Ollama which doesn't need API key
        apiKeys: {
          ollama: {
            isEnabled: true,
          },
        },
        courseCode: "COSC 121",
        streaming: false,
      });

      return {
        success: true,
        message: "API key is valid",
        response: response,
      };
    } catch (error) {
      if (
        error.message.includes("401") ||
        error.message.includes("Unauthorized")
      ) {
        return {
          success: false,
          error: "Invalid EduAI API key - authentication failed",
        };
      } else if (
        error.message.includes("403") ||
        error.message.includes("Forbidden")
      ) {
        return {
          success: false,
          error: "EduAI API key access forbidden",
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

