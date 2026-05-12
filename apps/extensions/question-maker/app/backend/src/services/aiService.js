/**
 * Legacy AI helper service for Groq/OpenAI/DeepSeek question generation and EduAI extraction utilities.
 * Provides text normalization helpers and topic assignment logic used by OCR uploads.
 */
import axios from "axios";
import { config } from "../config/settings.js";
import { Question_Metadata, Topics, Course } from "../schema/index.js";
import eduaiService from "./eduaiService.js";
import {
  normalizeExtractText,
  chunkText,
  splitIntoQuestionBlocks,
  chunkByQuestionBlocks,
  calculateQuestionTarget,
  extractedQuestionDedupeKey,
  deduplicateExtractedQuestions,
} from "./extractionUtils.js";

const AI_PROVIDERS = {
  GROQ: "groq",
  OPENAI: "openai",
  DEEPSEEK: "deepseek",
};

/** Calls the Groq chat API with a structured prompt and returns the raw content string. */
const callGroqAPI = async (prompt, params) => {
  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: `You are a question generation assistant. Generate exactly ${params.numQuestions} high-quality questions with the following distribution:
          - Easy: ${params.difficultyDistribution.easy} questions
          - Medium: ${params.difficultyDistribution.medium} questions
          - Hard: ${params.difficultyDistribution.hard} questions

          For each question:
          1. Classify its difficulty (easy/medium/hard)
          2. Classify its Bloom's Taxonomy level (remember/understand/apply/analyze/evaluate/create)
          3. Format each question as a JSON object
          
          IMPORTANT: Your response must be ONLY a valid JSON array of question objects. Do not include any other text.
          Each object must have this exact format:
          {
            "content": "The question text",
            "difficulty": "easy/medium/hard",
            "bloom_level": "remember/understand/apply/analyze/evaluate/create"
          }`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
        top_p: 0.9,
        stream: false,
      },
      {
        headers: {
          Authorization: `Bearer ${config.groqApiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    throw new Error(`Groq API error: ${error.message}`);
  }
};

// Legacy: OpenAI generator kept for reference; newer flows use EduAI instead.
/** Calls OpenAI chat completions to generate legacy questions for the question bank. */
const callOpenAIAPI = async (prompt, params) => {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "user",
            content: `Generate exactly ${params.numQuestions} high-quality questions with the following distribution:
          - Easy: ${params.difficultyDistribution.easy} questions
          - Medium: ${params.difficultyDistribution.medium} questions
          - Hard: ${params.difficultyDistribution.hard} questions

          For each question:
          1. Classify its difficulty (easy/medium/hard)
          2. Classify its Bloom's Taxonomy level (remember/understand/apply/analyze/evaluate/create)
          3. Format each question as a JSON object:
          {
            "content": "The question text",
            "difficulty": "easy/medium/hard",
            "bloom_level": "remember/understand/apply/analyze/evaluate/create"
          }

          IMPORTANT: Your response must be ONLY a valid JSON array of question objects. Do not include any other text.

          Topic to generate questions about: ${prompt}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 4000,
      },
      {
        headers: {
          Authorization: `Bearer ${config.openaiApiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    throw new Error(`OpenAI API error: ${error.message}`);
  }
};

/** Invokes DeepSeek’s chat endpoint to generate question payloads similar to Groq/OpenAI. */
const callDeepSeekAPI = async (prompt, params) => {
  try {
    const response = await axios.post(
      "https://api.deepseek.com/v1/chat/completions",
      {
        model: "deepseek-coder",
        messages: [
          {
            role: "user",
            content: `Generate exactly ${params.numQuestions} high-quality questions with the following distribution:
          - Easy: ${params.difficultyDistribution.easy} questions
          - Medium: ${params.difficultyDistribution.medium} questions
          - Hard: ${params.difficultyDistribution.hard} questions

          Each question MUST be formatted as a JSON object with these EXACT fields:
          {
            "content": "The complete question text here",
            "difficulty": "easy/medium/hard",
            "bloom_level": "remember/understand/apply/analyze/evaluate/create"
          }

          Your response MUST be a valid JSON array containing EXACTLY ${params.numQuestions} question objects.
          Do not include any text outside the JSON array.

          Topic to generate questions about: ${prompt}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 4000,
        stream: false,
      },
      {
        headers: {
          Authorization: `Bearer ${config.deepseekApiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    throw new Error(`DeepSeek API error: ${error.message}`);
  }
};

/** Derives a short summary/label from question text, capping at ~12 words. */
const summarizeQuestion = (text) => {
  if (!text) return "Question";
  const sanitized = text.replace(/\s+/g, " ").trim();
  if (!sanitized) return "Question";
  const words = sanitized.split(" ");
  if (words.length <= 12) {
    return sanitized.replace(/\?+$/, "");
  }
  return `${words.slice(0, 12).join(" ")}…`;
};

/** Splits a total count into easy/medium/hard buckets with guardrails. */
const buildDifficultyCounts = (total) => {
  let easy = Math.max(1, Math.floor(total * 0.4));
  let medium = Math.max(1, Math.floor(total * 0.4));
  let hard = total - easy - medium;
  if (hard < 0) {
    hard = 0;
  }
  if (hard === 0 && total > easy + medium) {
    hard = total - easy - medium;
  }
  let adjustment = total - (easy + medium + hard);
  if (adjustment !== 0) {
    hard += adjustment;
    if (hard < 0) {
      medium = Math.max(1, medium + hard);
      hard = 0;
    }
    adjustment = total - (easy + medium + hard);
    if (adjustment !== 0) {
      easy = Math.max(1, easy + adjustment);
    }
  }
  return {
    easy: Math.max(0, easy),
    medium: Math.max(0, medium),
    hard: Math.max(0, hard),
  };
};

/** Cleans and normalizes EduAI question objects into the format expected by uploads. */
const sanitizeEduAIQuestion = (question) => {
  const content =
    typeof question?.content === "string" ? question.content.trim() : "";
  if (!content) return null;
  const summarySource =
    typeof question?.description === "string" &&
    question.description.trim().length > 0
      ? question.description.trim()
      : summarizeQuestion(content);

  const difficulty = ["easy", "medium", "hard"].includes(
    question?.difficulty?.toLowerCase()
  )
    ? question.difficulty.toLowerCase()
    : "medium";

  const type = question?.type === "MCQ"
    ? "MCQ"
    : question?.type === "LA"
      ? "LA"
      : "SA";
  const primaryTopicId =
    Number.isInteger(question?.primary_topic_id) &&
    question.primary_topic_id > 0
      ? Number(question.primary_topic_id)
      : null;
  const secondaryTopicIds = Array.isArray(question?.secondary_topic_ids)
    ? Array.from(
        new Set(
          question.secondary_topic_ids
            .map((value) => Number(value))
            .filter(
              (value) => Number.isInteger(value) && value !== primaryTopicId
            )
        )
      )
    : [];

  // Preserve MCQ choices (array of { letter, text }) for OCR upload flow
  let choices = null;
  if (type === "MCQ" && Array.isArray(question?.choices) && question.choices.length > 0) {
    choices = question.choices
      .filter(
        (c) =>
          c &&
          typeof c === "object" &&
          typeof c.letter === "string" &&
          typeof c.text === "string"
      )
      .map((c) => ({
        letter: String(c.letter).trim().toUpperCase() || "A",
        text: String(c.text).trim(),
      }))
      .filter((c) => c.text.length > 0);
    if (choices.length < 2) choices = null;
  }

  // Preserve answer (letter for MCQ, full text for SA/LA)
  const answer =
    typeof question?.answer === "string" && question.answer.trim().length > 0
      ? question.answer.trim()
      : null;

  return {
    summary: summarySource,
    question: content,
    instructions: undefined,
    difficulty,
    answer,
    type,
    primaryTopicId,
    secondaryTopicIds,
    choices,
  };
};

/** Uses EduAI to extract questions from OCR’d text, chunking input and deduplicating outputs. */
const extractQuestionsWithEduAI = async (text, course, model = "ollama:gpt-oss:120b", apiKeys = {}) => {
  if (!eduaiService.isConfigured()) {
    throw new Error(
      "EduAI service is not configured. Please set EDUAI_API_KEY."
    );
  }

  const rawCode =
    (course?.code && course.code.trim()) || `COURSE-${course?.id ?? "UNKNOWN"}`;
  const courseCode = rawCode.replace(/\s+/g, "").toUpperCase();
  const { chunks, blockCountsPerChunk } = chunkByQuestionBlocks(text, 5000);
  const extracted = [];

  // Fetch topics for the course to include in the prompt
  let topics = [];
  if (course?.id) {
    try {
      topics = await Topics.findAll({
        where: { courseId: course.id },
        attributes: ['id', 'name'],
        order: [['name', 'ASC']]
      });
    } catch (error) {
      console.error("Failed to fetch topics for course", error.message);
      // Continue without topics if fetch fails
    }
  }

  // Format topics for the prompt
  const topicsSection = topics.length > 0
    ? `\n\nCourse topics:\n${topics.map(t => `- ID ${t.id}: ${t.name}`).join('\n')}\n`
    : '';

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const blockCount = blockCountsPerChunk[i];
    const numQuestions = blockCount != null && blockCount > 0
      ? Math.max(1, Math.min(blockCount, 15))
      : calculateQuestionTarget(chunk);
    const difficultyDistribution = buildDifficultyCounts(numQuestions);
    const reasoningDistribution = {
      factual: 40,
      analytical: 30,
      application: 30,
    };

    const continuationNote = i > 0
      ? " This segment continues from the previous one; do not treat content as a new \"Question 1\" unless the source explicitly starts a new numbered question.\n\n"
      : "";

    const extractionSystemPrompt = `You are an assistant that EXTRACTS exam-ready questions from source material. Your job is to list every complete question block that appears in the text. Do NOT generate new questions or improvise—only extract or paraphrase what is actually in the source.

CRITICAL — extraction only:
- EXTRACT or preserve the exact wording of tasks/questions from the source. Do not invent new questions (e.g. do not turn assignment instructions into MCQs about time complexity).
- One output question = one logical question block. A block includes ALL its sub-parts: (a), (b), (c), (i), (ii), etc.
- **AP / standardized tests**: Phrases like "Consider the following method(s)", "1.", "2.", "SECTION I: Multiple-Choice", and blocks with Java/UML/code followed by (A)(B)(C)(D) options ARE questions. Extract each numbered item as one question (type MCQ when choices exist).
- Treat assignment parts as question blocks even when not in classic "1. (a)(b)(c)" form: e.g. "Part 1", "Task 1", "Exercise 1", "Section 1" or prose instructions are valid blocks—extract each as one question with full text.
- Do NOT split a single numbered question into multiple entries. Do NOT merge two different questions into one entry.
- **Boilerplate** (e.g. "DO NOT OPEN THIS BOOKLET", "GO ON TO THE NEXT PAGE", copyright lines) is NOT a question—skip it, but if the SAME chunk also contains real numbered questions, extract those.
${continuationNote}Requirements:
- Preserve numbering, sub-parts, and instructions exactly as in the source. Use \\n for line breaks inside the question text.
- Provide a concise "description" (<= 12 words) that summarizes the question without repeating it verbatim.
- Set answer to null if unknown. Do NOT fabricate answers.
- Assign primary_topic_id and secondary_topic_ids from the course topics in the user message when relevant.
- Always set "reasoning_level" to one of: factual, analytical, application (use "factual" if unsure).

Format each question as a JSON object with these exact fields:
  {
    "content": "Full question/task text as in source (for MCQ: question only, put options in choices)",
    "description": "Brief summary (<= 12 words)",
    "difficulty": "easy/medium/hard",
    "reasoning_level": "factual/analytical/application",
    "type": "MCQ/SA/LA",
    "answer": null or "answer text",
    "primary_topic_id": number | null,
    "secondary_topic_ids": number[],
    "choices": [{"letter": "A", "text": "..."}, ...]  // REQUIRED for MCQ only
  }

ERROR HANDLING: Return {"error": true, "reason": "..."} ONLY if the segment is empty, whitespace-only, or contains no question-like content (no numbers, no code, no "Consider"/"Question"/choice letters). If you see ANY numbered exam item or MCQ, you MUST return a JSON array, not an error. No markdown, no code fence.`;

    const extractionUserPrompt = `Extract every complete question or task block from the source material below. Preserve wording; do not generate new questions.${topicsSection}

Source material:
"""
${chunk}
"""`;

    const extractionRetrySystemPrompt = `You extract exam questions from text. The input is always from a real exam (e.g. AP Computer Science). Extract EVERY numbered or "Consider the following" item as one JSON object. Use type MCQ when (A)-(E) or (A)-(D) choices appear. Use difficulty "medium" and reasoning_level "factual" when unsure. Return ONLY a JSON array of objects with fields: content, description, difficulty, reasoning_level, type, answer (or null), primary_topic_id (null), secondary_topic_ids ([]), choices (for MCQ). Never return {"error":true} unless the text is literally empty.`;

    const extractionRetryUserPrompt = `Extract all questions from:\n"""${chunk}"""`;

    const runChunkExtraction = async (systemPrompt, userPrompt) => {
      const questions = await eduaiService.generateQuestions({
        prompt: chunk,
        courseCode,
        model,
        apiKeys,
        numQuestions,
        difficultyDistribution,
        reasoningDistribution,
        systemPromptOverride: systemPrompt,
        userPromptOverride: userPrompt,
      });
      return questions
        .map((question) => sanitizeEduAIQuestion(question))
        .filter(Boolean);
    };

    try {
      let sanitized = await runChunkExtraction(extractionSystemPrompt, extractionUserPrompt);
      if (sanitized.length === 0) {
        throw new Error("No questions extracted from chunk after sanitization");
      }
      extracted.push(...sanitized);
    } catch (error) {
      console.warn("EduAI extraction chunk failed, retrying with simplified prompt", {
        chunkIndex: i,
        message: error.message,
      });
      try {
        const sanitizedRetry = await runChunkExtraction(
          extractionRetrySystemPrompt,
          extractionRetryUserPrompt
        );
        if (sanitizedRetry.length === 0) {
          throw new Error(error.message || "Extraction produced no questions");
        }
        extracted.push(...sanitizedRetry);
      } catch (retryError) {
        console.error("EduAI extraction failed for chunk", retryError.message);
        throw retryError;
      }
    }
  }

  const deduped = deduplicateExtractedQuestions(extracted);
  return deduped;
};

// Legacy: OpenAI extractor retained for reference; current upload flow uses EduAI.
/** Legacy helper that asks OpenAI to extract structured questions from a chunk of text. */
const callOpenAIForExtraction = async (textChunk) => {
  if (!config.openaiApiKey) {
    throw new Error(
      "OpenAI API key is not configured. Please add it to the .env file."
    );
  }

  const systemPrompt = `You are an assistant that extracts study questions from source material.
Return a JSON array (no additional text). Each object must follow this shape exactly:
{
  "summary": "Short descriptive sentence (<=12 words, no trailing question mark)",
  "question": "Full question text exactly as presented to students. Include all sub-parts, numbering, and instructions. Use \\n to represent line breaks.",
  "instructions": "Optional teaching notes or context (string, omit or set to null if not available)",
  "difficulty": "easy | medium | hard",
  "answer": "Optional short answer text or null",
  "type": "MCQ | SA | LA"
}

Guidelines:
- Treat each contiguous question block as a single entry even when it contains sub-parts (a), (b), etc.
- Preserve the question wording verbatim; do not omit instructions, numbering, or formatting cues.
- Use the instructions field only for teacher-facing notes that are separate from the student prompt.
- Do not fabricate content. If no valid question exists, return [].`;

  const userPrompt = `Extract distinct assessment questions from the following content. Focus on question statements that can be asked to students.

Ensure each question you return includes every related instruction, bullet, and sub-part that accompanies it. Never split multi-part questions into separate entries. Preserve the original formatting by inserting \\n where new lines occur.

Source material:
"""
${textChunk}
"""`;

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-3.5-turbo",
      temperature: 0.2,
      max_tokens: 1500,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
    }
  );

  const content = response.data?.choices?.[0]?.message?.content ?? "[]";
  return content;
};

/** Validates and normalizes a raw extracted question entry before persistence. */
const sanitizeExtractedQuestion = (raw) => {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const questionText =
    typeof raw.question === "string" ? raw.question.trim() : "";
  if (!questionText) {
    return null;
  }

  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  if (!summary) {
    return null;
  }

  const difficulty =
    typeof raw.difficulty === "string"
      ? raw.difficulty.toLowerCase().trim()
      : "";

  const allowedDifficulty = ["easy", "medium", "hard"].includes(difficulty)
    ? difficulty
    : "medium";
  const type =
    typeof raw.type === "string" && ["MCQ", "SA", "LA"].includes(raw.type)
      ? raw.type
      : "SA";

  return {
    summary,
    question: questionText,
    instructions:
      typeof raw.instructions === "string"
        ? raw.instructions.trim() || undefined
        : undefined,
    difficulty: allowedDifficulty,
    answer: typeof raw.answer === "string" ? raw.answer.trim() || null : null,
    type,
    primaryTopicId: null,
    secondaryTopicIds: [],
  };
};

// Legacy: OpenAI topic assignment retained for reference; current pipeline uses EduAI metadata.
/** Legacy helper that calls OpenAI to assign topic IDs to extracted questions. */
const callOpenAIForTopicAssignment = async (questions, topics) => {
  if (!config.openaiApiKey) {
    throw new Error(
      "OpenAI API key is not configured. Please add it to the .env file."
    );
  }

  const systemPrompt = `You are an assistant that assigns course topics to questions.
You will receive JSON with two arrays: topics and questions.
- topics: array of { "id": number, "name": string }
- questions: array of { "index": number, "summary": string, "question": string }

Return ONLY a JSON array. Each element must have:
{
  "index": number,                 // matches the question index from input
  "primaryTopicId": number | null, // id from provided topics, or null if no good match
  "secondaryTopicIds": number[]    // optional additional topic ids, exclude the primary id, no duplicates
}

Use only IDs from the provided topics. Keep the array order identical to the input questions.`;

  const payload = JSON.stringify(
    {
      topics: topics.map((topic) => ({
        id: topic.id,
        name: topic.name,
      })),
      questions: questions.map((question, index) => ({
        index,
        summary: question.summary,
        question: question.question,
      })),
    },
    null,
    2
  );

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-3.5-turbo",
      temperature: 0,
      max_tokens: 1200,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: payload },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
    }
  );

  return response.data?.choices?.[0]?.message?.content ?? "[]";
};

/** Normalizes the topic assignment payload, ensuring IDs exist and removing duplicates. */
const sanitizeTopicAssignment = (raw, validTopicIds) => {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const index = Number(raw.index);
  if (!Number.isInteger(index) || index < 0) {
    return null;
  }

  let primaryTopicId = raw.primaryTopicId;
  if (primaryTopicId === null || primaryTopicId === undefined) {
    primaryTopicId = null;
  } else {
    primaryTopicId = Number(primaryTopicId);
    if (!validTopicIds.has(primaryTopicId)) {
      primaryTopicId = null;
    }
  }

  let secondaryTopicIds = [];
  if (Array.isArray(raw.secondaryTopicIds)) {
    const seen = new Set();
    secondaryTopicIds = raw.secondaryTopicIds
      .map((value) => Number(value))
      .filter((value) => {
        if (!validTopicIds.has(value)) {
          return false;
        }
        if (value === primaryTopicId) {
          return false;
        }
        if (seen.has(value)) {
          return false;
        }
        seen.add(value);
        return true;
      });
  }

  return {
    index,
    primaryTopicId,
    secondaryTopicIds,
  };
};

/** Enriches extracted questions with topic IDs using OpenAI when local topics are available. */
const enrichQuestionsWithTopics = async (questions, courseId) => {
  if (!courseId) {
    return questions;
  }

  const topics = await Topics.findAll({
    where: { courseId },
    order: [["id", "ASC"]],
  });

  if (topics.length === 0) {
    return questions;
  }

  try {
    const response = await callOpenAIForTopicAssignment(questions, topics);
    const parsed = JSON.parse(response);
    if (!Array.isArray(parsed)) {
      return questions;
    }

    const validTopicIds = new Set(topics.map((topic) => topic.id));
    const assignmentMap = new Map();

    parsed.forEach((item) => {
      const sanitized = sanitizeTopicAssignment(item, validTopicIds);
      if (sanitized) {
        assignmentMap.set(sanitized.index, sanitized);
      }
    });

    const fallbackTopicId = topics[0]?.id ?? null;

    return questions.map((question, index) => {
      const assignment = assignmentMap.get(index);
      const primaryTopicId =
        assignment?.primaryTopicId ??
        fallbackTopicId ??
        question.primaryTopicId ??
        null;
      const candidateSecondary = Array.isArray(assignment?.secondaryTopicIds)
        ? [...assignment.secondaryTopicIds]
        : Array.isArray(question.secondaryTopicIds)
        ? [...question.secondaryTopicIds]
        : [];
      const secondaryTopicIds = candidateSecondary.filter(
        (id) => id !== primaryTopicId
      );

      return {
        ...question,
        primaryTopicId,
        secondaryTopicIds,
      };
    });
  } catch (error) {
    console.error("Failed to assign topics via AI", error);
    return questions;
  }
};

/** Public API to normalize raw upload text and run EduAI extraction for a course. */
export const extractQuestionsFromText = async (rawText, courseId, model, apiKeys) => {
  const normalized = normalizeExtractText(rawText);
  if (!normalized) {
    return [];
  }

  const course = await Course.findByPk(courseId, {
    attributes: ["id", "code", "name"],
  });

  const extracted = await extractQuestionsWithEduAI(normalized, course, model, apiKeys);
  return extracted;
};

/** Invokes the selected AI provider to generate structured questions, parsing/validating results. */
export const generateQuestions = async (prompt, provider, params) => {
  try {
    let response;

    switch (provider) {
      case AI_PROVIDERS.GROQ:
        response = await callGroqAPI(prompt, params);
        break;
      case AI_PROVIDERS.OPENAI:
        response = await callOpenAIAPI(prompt, params);
        break;
      case AI_PROVIDERS.DEEPSEEK:
        response = await callDeepSeekAPI(prompt, params);
        break;
      default:
        throw new Error(`Unsupported AI provider: ${provider}`);
    }

    // Parse and validate response
    try {
      const questions = JSON.parse(response);
      if (!Array.isArray(questions)) {
        throw new Error("Response is not an array");
      }

      // Validate each question
      const validQuestions = questions.filter(
        (q) =>
          q.content &&
          q.difficulty &&
          q.bloom_level &&
          ["easy", "medium", "hard"].includes(q.difficulty) &&
          [
            "remember",
            "understand",
            "apply",
            "analyze",
            "evaluate",
            "create",
          ].includes(q.bloom_level)
      );

      if (validQuestions.length === 0) {
        throw new Error("No valid questions found in response");
      }

      return validQuestions;
    } catch (parseError) {
      // If parsing fails, return a single question with the response text
      return [
        {
          content: response,
          difficulty: "medium",
          bloom_level: "understand",
        },
      ];
    }
  } catch (error) {
    throw error;
  }
};

export {
  AI_PROVIDERS,
  splitIntoQuestionBlocks,
  chunkByQuestionBlocks,
  extractedQuestionDedupeKey,
  deduplicateExtractedQuestions,
  normalizeExtractText,
};
