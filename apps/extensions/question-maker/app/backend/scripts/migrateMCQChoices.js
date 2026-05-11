/**
 * Migration script to extract choices from existing MCQ questionText and populate the new choices field.
 * This script:
 * 1. Finds all MCQ variants
 * 2. Parses choices from questionText
 * 3. Populates the choices field
 * 4. Removes choices from questionText (keeps only the question)
 * 5. Normalizes answer field to just the letter (e.g., "B" instead of "B) Option B")
 */

// CRITICAL: Load environment variables FIRST before any imports that depend on them
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

// Get the directory of the current file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from the project root
const projectRoot = join(__dirname, '../../../');
const envPath = join(projectRoot, '.env');

// Check if .env file exists
if (!existsSync(envPath)) {
  console.error('❌ Error: .env file not found!');
  console.error(`   Expected location: ${envPath}`);
  process.exit(1);
}

// Load environment variables
const result = dotenv.config({ path: envPath });
if (result.error) {
  console.error('❌ Error loading .env file:', result.error.message);
  process.exit(1);
}

// Check if DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.error('❌ Error: DATABASE_URL is not set in .env file');
  process.exit(1);
}

// If running on host (not in Docker), use localhost and host-published port (default 55432)
if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('@postgres:')) {
  const isDocker = process.env.DOCKER === 'true' || process.env.COMPOSE_PROJECT_NAME;
  if (!isDocker) {
    const hostPort = process.env.POSTGRES_HOST_PORT || '55432';
    process.env.DATABASE_URL = process.env.DATABASE_URL.replace('@postgres:5432', `@localhost:${hostPort}`);
  }
}

// Import database and schema modules
const dbModule = await import('../src/config/database.js');
const schemaModule = await import('../src/schema/index.js');
const { sequelize } = dbModule;
const { Variants, Question_Metadata } = schemaModule;

/**
 * Parses choices from question text in formats like:
 * - "Question text\nA) Option A\nB) Option B\nC) Option C\nD) Option D"
 * - "Question text a) Option A b) Option B c) Option C d) Option D"
 * Returns { questionText: string, choices: Array<{letter: string, text: string}> }
 */
const parseChoicesFromQuestionText = (questionText) => {
  if (!questionText || typeof questionText !== 'string') {
    return { questionText: questionText || '', choices: [] };
  }

  const lines = questionText.split('\n');
  const choices = [];
  let questionLines = [];
  let foundChoices = false;

  // Try to match patterns like "A) Option text" or "a) Option text"
  const choicePattern = /^([A-Za-z])\)\s*(.+)$/;

  for (const line of lines) {
    const trimmedLine = line.trim();
    const match = trimmedLine.match(choicePattern);
    
    if (match) {
      foundChoices = true;
      const letter = match[1].toUpperCase();
      const text = match[2].trim();
      choices.push({ letter, text });
    } else if (trimmedLine) {
      // If we haven't found choices yet, it's part of the question
      // If we have found choices, ignore any non-choice lines after
      if (!foundChoices) {
        questionLines.push(line);
      }
    }
  }

  // If no choices found with newline format, try inline format
  // "Question text a) Option A b) Option B c) Option C d) Option D"
  if (choices.length === 0) {
    const inlinePattern = /([a-z])\)\s*([^a-z)]+?)(?=\s+[a-z]\)|$)/gi;
    const matches = [...questionText.matchAll(inlinePattern)];
    
    if (matches.length > 0) {
      // Find where choices start (before first match)
      const firstMatchIndex = matches[0].index;
      const questionPart = questionText.substring(0, firstMatchIndex).trim();
      questionLines = questionPart ? [questionPart] : [];
      
      matches.forEach(match => {
        const letter = match[1].toUpperCase();
        const text = match[2].trim();
        choices.push({ letter, text });
      });
    }
  }

  const cleanQuestionText = questionLines.join('\n').trim();
  
  return {
    questionText: cleanQuestionText || questionText, // Fallback to original if parsing fails
    choices: choices.length > 0 ? choices : []
  };
};

/**
 * Extracts just the letter from answer text.
 * Handles formats like: "B", "B)", "B) Option B", "b", etc.
 */
const extractAnswerLetter = (answer) => {
  if (!answer || typeof answer !== 'string') {
    return null;
  }

  const trimmed = answer.trim();
  // Match letter at the start, optionally followed by ) or other text
  const match = trimmed.match(/^([A-Za-z])/);
  return match ? match[1].toUpperCase() : trimmed;
};

/**
 * Main migration function
 */
const migrateMCQChoices = async () => {
  try {
    console.log('🔌 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Database connection established.');

    // Sync schema to ensure choices column exists
    console.log('🔄 Syncing database schema...');
    await sequelize.sync({ alter: true });
    console.log('✅ Database schema synced.');

    // Find all MCQ variants
    console.log('🔍 Finding MCQ variants...');
    const mcqVariants = await Variants.findAll({
      include: [{
        model: Question_Metadata,
        as: 'questionMetadata',
        where: { type: 'MCQ' },
        required: true
      }]
    });

    console.log(`📊 Found ${mcqVariants.length} MCQ variants to migrate.`);

    if (mcqVariants.length === 0) {
      console.log('✅ No MCQ variants found. Migration complete.');
      await sequelize.close();
      return;
    }

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const variant of mcqVariants) {
      try {
        // Skip if choices already exist
        if (variant.choices && Array.isArray(variant.choices) && variant.choices.length > 0) {
          console.log(`⏭️  Skipping variant ${variant.id} - already has choices`);
          skipped++;
          continue;
        }

        const questionText = variant.questionText || '';
        const answer = variant.answer || '';

        // Parse choices from question text
        const parsed = parseChoicesFromQuestionText(questionText);

        if (parsed.choices.length === 0) {
          console.log(`⚠️  Variant ${variant.id}: No choices found in question text, skipping`);
          skipped++;
          continue;
        }

        // Normalize answer to just letter
        const normalizedAnswer = extractAnswerLetter(answer);

        // Update variant
        await variant.update({
          choices: parsed.choices,
          questionText: parsed.questionText,
          answer: normalizedAnswer || answer // Keep original if extraction fails
        });

        console.log(`✅ Migrated variant ${variant.id}: ${parsed.choices.length} choices extracted`);
        migrated++;

      } catch (error) {
        console.error(`❌ Error migrating variant ${variant.id}:`, error.message);
        errors++;
      }
    }

    console.log('\n📈 Migration Summary:');
    console.log(`   ✅ Migrated: ${migrated}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log(`   📊 Total: ${mcqVariants.length}`);

    if (errors === 0) {
      console.log('\n✅ Migration completed successfully!');
    } else {
      console.log('\n⚠️  Migration completed with errors. Please review the output above.');
    }

    await sequelize.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    await sequelize.close();
    process.exit(1);
  }
};

// Run migration
migrateMCQChoices();
