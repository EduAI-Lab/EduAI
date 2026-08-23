/**
 * Loads environment variables from the project root and exposes a normalized configuration object for the backend.
 * Provides sensible defaults for development while enforcing required secrets (e.g., encryption key) in production.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const positiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Parse CORS_ORIGINS into an explicit allowlist, rejecting a wildcard ("*")
 * outside development/test (#1569 review). The cors() middleware (app.js) and
 * the CSRF origin guard (middleware/csrfOrigin.js) both derive their trust set
 * from this list, so a production `CORS_ORIGINS=*` would let any Origin through
 * and defeat the independent CSRF backstop. Mirrors AI Tutor's config/cors.js,
 * which refuses the wildcard rather than relying on a comment that it is
 * dev-only. (`csrfOrigin.normalizeOrigin` also drops "*", so the CSRF guard is
 * never trust-listed on a wildcard; this fails the misconfig loudly at boot
 * instead of silently widening CORS.)
 */
export const parseCorsOrigins = (
  raw = process.env.CORS_ORIGINS,
  nodeEnv = process.env.NODE_ENV,
) => {
  if (!raw) return ["http://localhost:5173"];
  const entries = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const env = nodeEnv?.trim();
  const devOrTest = !env || env === "development" || env === "test";
  if (!devOrTest && entries.some((entry) => entry.includes("*"))) {
    throw new Error(
      "CORS_ORIGINS must not contain a wildcard (*) outside development/test. Use explicit origins only.",
    );
  }
  return entries.length ? entries : ["http://localhost:5173"];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../../../");

// Load environment variables from project root
dotenv.config({ path: path.join(projectRoot, ".env") });

/** Centralized application settings derived from environment variables for use across services and routes. */
export const config = {
  // Server
  port: process.env.PORT || 8000,
  nodeEnv: process.env.NODE_ENV || "development",

  // Database
  databaseUrl: process.env.DATABASE_URL || "postgresql://postgres:password@localhost:5432/eduquery",

  // Core integration
  coreUrl: process.env.CORE_URL || "http://localhost:3000",
  corePublicOrigin:
    process.env.CORE_PUBLIC_ORIGIN || process.env.CORE_URL || "http://localhost:3000",
  extensionUrl: process.env.EXTENSION_URL || "http://localhost:8000",

  // Security
  encryptionKey:
    process.env.ENCRYPTION_KEY ||
    (() => {
      // Generate a random key for development if not set
      // WARNING: This should NEVER be used in production
      if (process.env.NODE_ENV === "production") {
        throw new Error("ENCRYPTION_KEY must be set in production environment");
      }
      console.warn(
        "⚠️  WARNING: ENCRYPTION_KEY not set. Using a temporary key for development only.",
      );
      return "dev-encryption-key-change-in-production-" + Date.now();
    })(),

  // CORS
  corsOrigins: parseCorsOrigins(),

  // API Keys
  groqApiKey: process.env.GROQ_API_KEY || "",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
  googleGenerativeAiApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || "",

  // EduAI API Configuration
  eduaiApiUrl: process.env.EDUAI_API_URL || "https://eduai.ok.ubc.ca",
  eduaiApiKey: process.env.EDUAI_API_KEY || "",
  /** Comma-separated course codes or IDs to hide from the course list (e.g. EDUAI_IGNORED_COURSE_CODES=STUDY1,STUDY2). */
  eduaiIgnoredCourseCodes: (process.env.EDUAI_IGNORED_COURSE_CODES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // AI Settings
  defaultNumQuestions: parseInt(process.env.DEFAULT_NUM_QUESTIONS) || 15,
  maxQuestions: parseInt(process.env.MAX_QUESTIONS) || 50,

  // Question-maker AI resource budgets. These are deliberately finite so a
  // malformed upload or repeated legacy request cannot create unbounded OCR
  // chunks/provider calls. Override per deployment with QM_* environment vars.
  qmMaxExtractTextChars: positiveInt(process.env.QM_MAX_EXTRACT_TEXT_CHARS, 120_000),
  qmMaxExtractChunks: positiveInt(process.env.QM_MAX_EXTRACT_CHUNKS, 24),
  qmMaxExtractProviderCalls: positiveInt(process.env.QM_MAX_EXTRACT_PROVIDER_CALLS, 36),
  qmExtractDeadlineMs: positiveInt(process.env.QM_EXTRACT_DEADLINE_MS, 120_000),
  qmAiProviderTimeoutMs: positiveInt(process.env.QM_AI_PROVIDER_TIMEOUT_MS, 30_000),
  qmGeneratePromptMaxChars: positiveInt(process.env.QM_GENERATE_PROMPT_MAX_CHARS, 12_000),
  qmAiRateLimitWindowMs: positiveInt(process.env.QM_AI_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  // AI routes are caller-admitted as a group. Request-count limiting is only
  // a secondary guard; provider-call admission below accounts for fanout.
  qmAiRateLimitMax: positiveInt(process.env.QM_AI_RATE_LIMIT_MAX, 20),
  qmAiProviderCallLimit: positiveInt(process.env.QM_AI_PROVIDER_CALL_LIMIT, 60),
  qmAiOperationDeadlineMs: positiveInt(process.env.QM_AI_OPERATION_DEADLINE_MS, 90_000),
  qmBankMaxQuestionIds: positiveInt(process.env.QM_BANK_MAX_QUESTION_IDS, 10),
  qmBankMaxVariantsPerQuestion: positiveInt(process.env.QM_BANK_MAX_VARIANTS_PER_QUESTION, 2),
  qmBankMaxProviderCalls: positiveInt(process.env.QM_BANK_MAX_PROVIDER_CALLS, 24),
  qmReviewMaxPairs: positiveInt(process.env.QM_REVIEW_MAX_PAIRS, 10),
  qmReviewMaxProviderCalls: positiveInt(process.env.QM_REVIEW_MAX_PROVIDER_CALLS, 21),
  qmChatMaxMessages: positiveInt(process.env.QM_CHAT_MAX_MESSAGES, 40),
  qmChatMaxMessageChars: positiveInt(process.env.QM_CHAT_MAX_MESSAGE_CHARS, 12_000),
  qmChatMaxAggregateChars: positiveInt(process.env.QM_CHAT_MAX_AGGREGATE_CHARS, 80_000),
  qmTestApiKeyMaxBodyBytes: positiveInt(process.env.QM_TEST_API_KEY_MAX_BODY_BYTES, 8_192),
  qmTestApiKeyMaxProviderKeyChars: positiveInt(
    process.env.QM_TEST_API_KEY_MAX_PROVIDER_KEY_CHARS,
    512,
  ),

  // Canvas outbound request budgets. Every request has a socket/response
  // deadline and every multi-page operation has a shared wall-clock deadline.
  // Response limits are enforced both before reading a declared wire length
  // and while consuming the decompressed body.
  canvasRequestTimeoutMs: positiveInt(
    process.env.CANVAS_REQUEST_TIMEOUT_MS,
    positiveInt(process.env.CANVAS_PER_REQUEST_TIMEOUT_MS, 15_000),
  ),
  canvasOperationTimeoutMs: positiveInt(
    process.env.CANVAS_OPERATION_TIMEOUT_MS,
    positiveInt(process.env.CANVAS_PAGINATION_DEADLINE_MS, 60_000),
  ),
  canvasMaxCompressedResponseBytes: positiveInt(
    process.env.CANVAS_MAX_COMPRESSED_RESPONSE_BYTES,
    positiveInt(process.env.CANVAS_MAX_WIRE_BYTES, 10 * 1024 * 1024),
  ),
  canvasMaxResponseBytes: positiveInt(
    process.env.CANVAS_MAX_RESPONSE_BYTES,
    positiveInt(process.env.CANVAS_MAX_DECOMPRESSED_RESPONSE_BYTES, 10 * 1024 * 1024),
  ),
  canvasMaxRequestBodyBytes: positiveInt(
    process.env.CANVAS_MAX_REQUEST_BODY_BYTES,
    2 * 1024 * 1024,
  ),
  canvasMaxPages: positiveInt(
    process.env.CANVAS_MAX_PAGES,
    positiveInt(process.env.CANVAS_PAGINATION_MAX_PAGES, 100),
  ),
  canvasMaxItems: positiveInt(
    process.env.CANVAS_MAX_ITEMS,
    positiveInt(process.env.CANVAS_PAGINATION_MAX_ITEMS, 10_000),
  ),

  // Rate Limiting
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 1000,

  // Logging
  logLevel: process.env.LOG_LEVEL || "info",

  // Bug report admin access (emails that may access the bug-report triage UI)
  bugReportAdminEmails: (process.env.BUG_REPORT_ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

/**
 * Fail-fast check for Core S2S auth. Call at process startup (e.g. startServer),
 * not while constructing `config`, so tests can import settings without EDUAI_API_KEY.
 *
 * Core `/api/sessions/validate` 403s without a service key. `coreUrl` defaults to
 * localhost, so production and development always require EDUAI_API_KEY.
 */
export function assertCoreServiceKeyConfigured(settings = config) {
  const coreUrl = typeof settings?.coreUrl === "string" ? settings.coreUrl.trim() : "";
  if (!coreUrl) return;

  const eduaiApiKey = typeof settings?.eduaiApiKey === "string" ? settings.eduaiApiKey.trim() : "";
  if (eduaiApiKey) return;

  throw new Error(
    "EDUAI_API_KEY is required when Core is configured. Core session validation rejects requests without a service key.",
  );
}

export default config;
