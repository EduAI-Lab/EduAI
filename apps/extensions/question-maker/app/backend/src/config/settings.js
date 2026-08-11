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
  corsOrigins: process.env.CORS_ORIGINS?.split(",") || ["http://localhost:5173"],

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
  qmAiRateLimitMax: positiveInt(process.env.QM_AI_RATE_LIMIT_MAX, 60),

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

export default config;
