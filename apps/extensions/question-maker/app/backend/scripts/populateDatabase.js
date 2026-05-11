/**
 * Seeds the application database with sample users, courses, topics, assessments, and variants.
 * Loads environment variables from the project root and normalizes the DATABASE_URL for local vs Docker runs before touching Sequelize.
 */
// CRITICAL: Load environment variables FIRST before any imports that depend on them
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

// Get the directory of the current file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from the project root (3 levels up from scripts/populateDatabase.js)
const projectRoot = join(__dirname, '../../../');
const envPath = join(projectRoot, '.env');

// Check if .env file exists
if (!existsSync(envPath)) {
  console.error('❌ Error: .env file not found!');
  console.error(`   Expected location: ${envPath}`);
  console.error(`   Project root: ${projectRoot}`);
  console.error('\n   Please create a .env file in the project root directory with DATABASE_URL defined.');
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
  console.error(`   .env file location: ${envPath}`);
  console.error('   Please ensure DATABASE_URL is defined in your .env file.');
  process.exit(1);
}

// If running on host (not in Docker), replace 'postgres' with 'localhost' and use host-published port.
// Docker publishes postgres as 55432:5432 in production; from the host we must use 55432.
if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('@postgres:')) {
  const isDocker = process.env.DOCKER === 'true' || process.env.COMPOSE_PROJECT_NAME;
  if (!isDocker) {
    const hostPort = process.env.POSTGRES_HOST_PORT || '55432';
    console.log(`ℹ️  Running on host - connecting to localhost:${hostPort} (set POSTGRES_HOST_PORT if different)`);
    process.env.DATABASE_URL = process.env.DATABASE_URL.replace('@postgres:5432', `@localhost:${hostPort}`);
    console.log(`   Using DATABASE_URL: ${process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);
  }
}

// Import bcrypt (doesn't depend on env vars)
import bcrypt from 'bcryptjs';
import { TOPIC_NAMES_BY_TEMPLATE, SEED_QUESTIONS_BY_TEMPLATE } from './seedData.js';

// Dynamically import modules that depend on environment variables
// This ensures DATABASE_URL is modified before database.js is loaded
const dbModule = await import('../src/config/database.js');
const schemaModule = await import('../src/schema/index.js');
const { sequelize } = dbModule;
const {
  User,
  Course,
  Topics,
  Question_Metadata,
  Assessments,
  Variants,
  SectionVariants,
  AssessmentSections,
  CanvasIntegration,
  CanvasCourseMapping,
  BugReport
} = schemaModule;

/**
 * Connects to the database, clears existing records, and inserts the predefined seed dataset.
 * Emits progress logs for each stage so developers can verify connection, schema sync, and entity creation.
 */
const populateDatabase = async () => {
  try {
    console.log('Connecting to database...');
    await sequelize.authenticate();
    console.log('Database connection established.');

    // Sync database schema
    await sequelize.sync({ force: false });
    console.log('Database schema synced.');

    // Clear existing data (optional - comment out if you want to keep existing data)
    // Order matters: clear tables that reference others first (child tables before parent).
    console.log('Clearing existing data...');
    await SectionVariants.destroy({ where: {} });
    await Variants.destroy({ where: {} });
    await AssessmentSections.destroy({ where: {} });
    await Question_Metadata.destroy({ where: {} });
    await Assessments.destroy({ where: {} });
    await Topics.destroy({ where: {} });
    await CanvasCourseMapping.destroy({ where: {} });
    await CanvasIntegration.destroy({ where: {} });
    await Course.destroy({ where: {} });
    await BugReport.destroy({ where: {} });
    await User.destroy({ where: {} });
    console.log('Existing data cleared.');

    // 1. Create Users
    console.log('Creating users...');
    const hashedPassword = await bcrypt.hash('password', 10);
    const users = await User.bulkCreate([
      {
        email: 'a@mail.com',
        passwordHash: hashedPassword
      },
      {
        email: 'b@mail.com',
        passwordHash: hashedPassword
      },
      {
        email: 'c@mail.com',
        passwordHash: hashedPassword
      },
      {
        email: 'admin@mail.com',
        passwordHash: hashedPassword
      }
    ]);
    console.log(`Created ${users.length} users.`);

    // 2. Create Courses
    console.log('Creating courses...');
    const courses = await Course.bulkCreate([
      {
        name: 'Machine Architecture',
        code: 'COSC 211',
        userId: users[0].id
      },
      {
        name: 'Computer Programming II',
        code: 'COSC 121',
        userId: users[0].id
      },
      {
        name: 'Introduction to Statistics',
        code: 'STUDY1',
        userId: users[0].id
      },
      {
        name: 'Discrete Math',
        code: 'STUDY3',
        userId: users[0].id
      },
      {
        name: 'Introduction to Psychology',
        code: 'STUDY2',
        userId: users[0].id
      },
      {
        name: 'Introduction to Nursing',
        code: 'STUDY4',
        userId: users[0].id
      },
      {
        name: 'Scientific Research Methods',
        code: 'STUDY5',
        userId: users[0].id
      }
    ]);
    console.log(`Created ${courses.length} courses.`);

    // 3. Create Topics (from shared seed data)
    console.log('Creating topics...');
    const topicRows = [];
    for (let c = 0; c < courses.length; c++) {
      for (const name of TOPIC_NAMES_BY_TEMPLATE[c]) {
        topicRows.push({ name, courseId: courses[c].id });
      }
    }
    const topics = await Topics.bulkCreate(topicRows);
    console.log(`Created ${topics.length} topics.`);

    // 4. Create Assessments
    console.log('Creating assessments...');
    const assessments = await Assessments.bulkCreate([
      {
        type: 'Midterm',
        name: 'Midterm Exam 1',
        semester: 'Fall 2024'
      },
      {
        type: 'Final',
        name: 'Final Exam',
        semester: 'Fall 2024'
      },
      {
        type: 'Quiz',
        name: 'Quiz 1',
        semester: 'Fall 2024'
      },
      {
        type: 'Quiz',
        name: 'Quiz 2',
        semester: 'Fall 2024'
      },
      {
        type: 'Quiz',
        name: 'Quiz 3',
        semester: 'Fall 2024'
      },
      {
        type: 'Assignment',
        name: 'Assignment 1',
        semester: 'Fall 2024'
      },
      {
        type: 'Assignment',
        name: 'Assignment 2',
        semester: 'Fall 2024'
      },
      {
        type: 'Lab',
        name: 'Lab 1',
        semester: 'Fall 2024'
      },
      {
        type: 'Lab',
        name: 'Lab 2',
        semester: 'Fall 2024'
      },
      {
        type: 'Midterm',
        name: 'Midterm Exam 2',
        semester: 'Winter 2025'
      }
    ]);

    // One empty "Practice Exam" per course
    const practiceExams = await Assessments.bulkCreate(
      courses.map((c) => ({
        courseId: c.id,
        type: 'Quiz',
        name: 'Practice Exam',
        semester: 'Fall 2026'
      }))
    );
    console.log(`Created ${assessments.length} assessments and ${practiceExams.length} Practice Exam(s).`);

    // 5. Create Question_Metadata – 5 real questions per course for all 7 courses
    console.log('Creating question metadata...');
    
    const generateQuestionOrder = (questionIndex, totalQuestions) => {
      const order = {};
      const assessmentIndex = questionIndex % assessments.length;
      const questionNum = Math.floor(questionIndex / assessments.length) + 1;
      order[assessments[assessmentIndex].id] = questionNum;
      if (questionIndex % 3 === 0 && assessmentIndex + 1 < assessments.length) {
        order[assessments[assessmentIndex + 1].id] = questionNum;
      }
      return order;
    };

    // 5 questions per course (from shared seedData.js)
    const QUESTIONS_PER_COURSE = 5;
    const seedQuestionsByCourse = SEED_QUESTIONS_BY_TEMPLATE;

    // Topic ranges per course: [startIndex, endIndex) in topics array (from shared seed data)
    const courseTopicRanges = [];
    let _start = 0;
    for (const names of TOPIC_NAMES_BY_TEMPLATE) {
      courseTopicRanges.push([_start, _start + names.length]);
      _start += names.length;
    }

    const allQuestionMeta = [];
    let globalQuestionIndex = 0;

    for (let c = 0; c < courses.length; c++) {
      const [topicStart, topicEnd] = courseTopicRanges[c];
      const courseTopics = topics.slice(topicStart, topicEnd);
      const courseQuestions = seedQuestionsByCourse[c];

      for (let i = 0; i < QUESTIONS_PER_COURSE; i++) {
        const q = courseQuestions[i];
        const topicIndex = Math.min(q.topicIndex ?? i % courseTopics.length, courseTopics.length - 1);
        allQuestionMeta.push({
          description: q.description,
          type: q.type,
          courseId: courses[c].id,
          primaryTopicId: courseTopics[topicIndex].id,
          questionOrder: generateQuestionOrder(globalQuestionIndex, courses.length * QUESTIONS_PER_COURSE)
        });
        globalQuestionIndex++;
      }
    }

    const questionMetadata = await Question_Metadata.bulkCreate(allQuestionMeta);
    const seedQuestionTexts = seedQuestionsByCourse.flat();
    console.log(`Created ${questionMetadata.length} question metadata entries.`);

    // 6. Create Variants (at least 1 per question) using seeded question text, choices, and answers when available
    console.log('Creating variants...');
    
    const generateVariant = (qMeta, assessmentId, variantNum = 0, seedOverride = null) => {
      const difficulties = ['easy', 'medium', 'hard'];
      const reasoningLevels = ['factual', 'analytical', 'application'];
      const difficulty = difficulties[qMeta.id % difficulties.length];
      const reasoningLevel = reasoningLevels[qMeta.id % reasoningLevels.length];
      
      let questionText;
      let answer = null;
      let choices = null;

      // Prefer explicit seed override when provided
      if (seedOverride && seedOverride.questionText && seedOverride.answer) {
        questionText = seedOverride.questionText;
      
      if (qMeta.type === 'MCQ') {
          // For seeded MCQs we expect structured choices + correctAnswer
          if (Array.isArray(seedOverride.choices) && seedOverride.correctAnswer) {
            choices = seedOverride.choices.map((c) => ({
              letter: c.letter,
              text: c.text
            }));
            answer = seedOverride.correctAnswer;
          } else {
            // Backwards compatibility: try to parse answer like "B) Option B"
            const parsed = String(seedOverride.answer).trim();
            const match = /^([A-Z])\)/.exec(parsed);
            answer = match ? match[1] : parsed;
          }
        } else {
          // SA / LA keep full-text answer
          answer = seedOverride.answer;
        }
      } else {
        // No seed override: generate generic content
        if (qMeta.type === 'MCQ') {
          questionText = `What is the primary concept related to ${qMeta.description.toLowerCase()}?`;
          choices = [
            { letter: 'A', text: 'Option A' },
            { letter: 'B', text: 'Option B' },
            { letter: 'C', text: 'Option C' },
            { letter: 'D', text: 'Option D' }
          ];
          answer = 'B';
        } else if (qMeta.type === 'LA') {
          questionText = `Discuss ${qMeta.description.toLowerCase()} in depth.`;
          answer = `Answer for ${qMeta.description}.`;
        } else {
          questionText = `Explain ${qMeta.description.toLowerCase()}.`;
          answer = `Sample answer for ${qMeta.description}.`;
        }
      }

      const base = {
        questionText,
        difficulty,
        reasoningLevel,
        questionMetadataId: qMeta.id,
        assessmentId,
        answer
      };

      return qMeta.type === 'MCQ' && Array.isArray(choices)
        ? { ...base, choices }
        : base;
    };

    const variantsToCreate = [];
    for (let i = 0; i < questionMetadata.length; i++) {
      const qMeta = questionMetadata[i];
      const primaryAssessment = assessments[i % assessments.length];
      const seedOverride = seedQuestionTexts[i] || null;
      variantsToCreate.push(generateVariant(qMeta, primaryAssessment.id, 0, seedOverride));
    }

    const variants = await Variants.bulkCreate(variantsToCreate);
    console.log(`Created ${variants.length} variants.`);

    // Create some variant references (self-referencing)
    console.log('Creating variant references...');
    if (variants.length >= 2) {
      // Make variant[1] reference variant[0] (they're variants of the same question)
      await Variants.update(
        { referenceId: variants[0].id },
        { where: { id: variants[1].id } }
      );
      console.log('Created variant reference.');
    }

    console.log('\n✅ Database population completed successfully!');
    console.log(`\nSummary:`);
    console.log(`- Users: ${users.length}`);
    console.log(`- Courses: ${courses.length}`);
    console.log(`- Topics: ${topics.length}`);
    console.log(`- Assessments: ${assessments.length}`);
    console.log(`- Question Metadata: ${questionMetadata.length}`);
    console.log(`- Variants: ${variants.length}`);

  } catch (error) {
    console.error('Error populating database:', error);
    throw error;
  } finally {
    await sequelize.close();
    console.log('\nDatabase connection closed.');
  }
};

// Run the script
populateDatabase()
  .then(() => {
    console.log('\n✨ Script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
