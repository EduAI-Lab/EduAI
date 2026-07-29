/**
 * Production-safe seed: adds the same topics and questions as the development seed
 * to every existing course. Does NOT clear or destroy any data.
 * Uses shared seed data (seedData.js) so dev and production stay in sync.
 *
 * Usage (from project root): npm run seed:production
 * Or from app/backend: node scripts/seedProductionQuestions.js
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { TOPIC_NAMES_BY_TEMPLATE, SEED_QUESTIONS_BY_TEMPLATE } from './seedData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve .env in multiple contexts:
// - Host: repo root (../../.. from scripts/)
// - Backend container: /app/.env (copied in Dockerfile)
// - Optional explicit mount: /.env
const envCandidates = [
  join(__dirname, '../../../.env'),
  join('/app', '.env'),
  join('/', '.env'),
];

let envPath = null;
for (const candidate of envCandidates) {
  if (existsSync(candidate)) {
    envPath = candidate;
    break;
  }
}

if (!envPath) {
  console.error('❌ .env not found in any candidate path.');
  console.error('   Tried:', envCandidates);
  process.exit(1);
}

const result = dotenv.config({ path: envPath });
if (result.error) {
  console.error('❌ Error loading .env:', result.error.message);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set in .env');
  process.exit(1);
}

// Only rewrite DATABASE_URL when running on the host, not inside Docker.
if (process.env.DATABASE_URL.includes('@postgres:')) {
  const inDocker =
    process.env.DOCKER === 'true' ||
    !!process.env.COMPOSE_PROJECT_NAME ||
    process.cwd().startsWith('/app');

  if (!inDocker) {
    const hostPort = process.env.POSTGRES_HOST_PORT || '55432';
    console.log(
      `ℹ️  Running on host - connecting to localhost:${hostPort} (set POSTGRES_HOST_PORT if different)`
    );
    process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
      '@postgres:5432',
      `@localhost:${hostPort}`
    );
  } else {
    console.log('ℹ️  Running inside Docker - using postgres service hostname from DATABASE_URL');
  }
}

import { createId } from '@paralleldrive/cuid2';

const { prisma } = await import('../src/config/database.js');

const NUM_TEMPLATES = TOPIC_NAMES_BY_TEMPLATE.length;

// Course-code-based template mapping was retired with `Course.code` (#1072
// §4 step 10) — matching by code is exactly the "code as an identity key"
// pattern the parent issue's step 6 deleted elsewhere. Templates now just
// cycle by row order (`courseIndex % NUM_TEMPLATES`), same fallback this
// script already used for any unmapped code.

const run = async () => {
  try {
    console.log('Connecting to database...');
    await prisma.$queryRaw`SELECT 1`;
    console.log('Connected.\n');

    const courses = await prisma.course.findMany({ orderBy: { id: 'asc' } });
    if (!courses.length) {
      console.log('No courses found. Nothing to seed.');
      return;
    }

    console.log(`Found ${courses.length} course(s). Adding dev-seed topics and questions to each...\n`);

    let totalTopics = 0;
    let totalAssessments = 0;
    let totalQuestions = 0;
    let totalVariants = 0;

    for (let courseIndex = 0; courseIndex < courses.length; courseIndex++) {
      const course = courses[courseIndex];
      const templateIndex = courseIndex % NUM_TEMPLATES;
      const topicNames = TOPIC_NAMES_BY_TEMPLATE[templateIndex];
      const questions = SEED_QUESTIONS_BY_TEMPLATE[templateIndex];
      const courseLabel = `Course #${course.id}`;
      console.log(`  Course: ${courseLabel} (template ${templateIndex}: ${topicNames.length} topics, ${questions.length} questions)`);

      // Ensure all template topics exist for this course (find or create by name)
      const courseTopics = [];
      for (const name of topicNames) {
        let topic = await prisma.topics.findFirst({ where: { courseId: course.id, name } });
        if (!topic) {
          topic = await prisma.topics.create({ data: { id: createId(), name, courseId: course.id } });
          totalTopics++;
        }
        courseTopics.push(topic);
      }

      let assessment = await prisma.assessments.findFirst({ where: { courseId: course.id }, orderBy: { id: 'asc' } });
      if (!assessment) {
        // `semester` no longer exists on `Assessments` (#1072 §4 step 10/#1077).
        assessment = await prisma.assessments.create({
          data: {
            courseId: course.id,
            type: 'Quiz',
            name: 'Practice Exam'
          }
        });
        totalAssessments++;
        console.log(`    Created assessment "Practice Exam"`);
      }

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const topicIndex = Math.min(q.topicIndex ?? 0, courseTopics.length - 1);
        const primaryTopic = courseTopics[topicIndex];
        const order = { [assessment.id]: i + 1 };

        const meta = await prisma.questionMetadata.create({
          data: {
            description: q.description,
            type: q.type,
            courseId: course.id,
            primaryTopicId: primaryTopic.id,
            questionOrder: order
          }
        });
        totalQuestions++;

        const difficulties = ['easy', 'medium', 'hard'];
        const reasoningLevels = ['factual', 'analytical', 'application'];
        const variantPayload = {
          questionText: q.questionText,
          difficulty: difficulties[i % 3],
          reasoningLevel: reasoningLevels[i % 3],
          questionMetadataId: meta.id,
          assessmentId: assessment.id,
          answer: q.type === 'MCQ' && q.correctAnswer ? q.correctAnswer : q.answer,
          isDraft: false,
          isAiGenerated: false
        };
        if (q.type === 'MCQ' && Array.isArray(q.choices) && q.correctAnswer) {
          variantPayload.choices = q.choices.map((c) => ({ letter: c.letter, text: c.text }));
        }
        await prisma.variants.create({ data: variantPayload });
        totalVariants++;
      }
      console.log(`    Added ${topicNames.length} topics, ${questions.length} questions.`);
    }

    console.log('\n✅ Production seed completed (same topics & questions as development).');
    console.log(`   Topics created: ${totalTopics}`);
    console.log(`   Assessments created: ${totalAssessments}`);
    console.log(`   Question metadata created: ${totalQuestions}`);
    console.log(`   Variants created: ${totalVariants}`);
  } catch (err) {
    console.error('❌ Seed failed:', err);
    throw err;
  } finally {
    await prisma.$disconnect();
    console.log('\nDatabase connection closed.');
  }
};

run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
