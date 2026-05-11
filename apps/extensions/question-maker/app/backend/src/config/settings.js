/**
 * Loads environment variables from the project root and exposes a normalized configuration object for the backend.
 * Provides sensible defaults for development while enforcing required secrets (e.g., encryption key) in production.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the project root directory (4 levels up from app/backend/src/config/settings.js)
// app/backend/src/config -> app/backend/src -> app/backend -> app -> root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../../../');

// Load environment variables from project root
dotenv.config({ path: path.join(projectRoot, '.env') });

/** Centralized application settings derived from environment variables for use across services and routes. */
export const config = {
  // Server
  port: process.env.PORT || 8000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Database
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/eduquery',
  
  // Security
  jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 12,
  encryptionKey: process.env.ENCRYPTION_KEY || (() => {
    // Generate a random key for development if not set
    // WARNING: This should NEVER be used in production
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY must be set in production environment');
    }
    console.warn('⚠️  WARNING: ENCRYPTION_KEY not set. Using a temporary key for development only.');
    return 'dev-encryption-key-change-in-production-' + Date.now();
  })(),
  
  // CORS
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'],
  
  // API Keys
  groqApiKey: process.env.GROQ_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  
  // EduAI API Configuration
  eduaiApiUrl: process.env.EDUAI_API_URL || 'https://eduai.ok.ubc.ca',
  eduaiApiKey: process.env.EDUAI_API_KEY || '',
  /** Comma-separated course codes or IDs to hide from the course list (e.g. EDUAI_IGNORED_COURSE_CODES=STUDY1,STUDY2). */
  eduaiIgnoredCourseCodes: (process.env.EDUAI_IGNORED_COURSE_CODES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  
  // AI Settings
  defaultNumQuestions: parseInt(process.env.DEFAULT_NUM_QUESTIONS) || 15,
  maxQuestions: parseInt(process.env.MAX_QUESTIONS) || 50,
  
  // Rate Limiting
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 1000,
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info'
};

export default config;
