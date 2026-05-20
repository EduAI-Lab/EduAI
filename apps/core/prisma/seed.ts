import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  console.log('Seeding AI Providers...');

  const openaiProvider = await prisma.aIProvider.upsert({
    where: { name: 'openai' },
    update: {},
    create: {
      name: 'openai',
      displayName: 'OpenAI',
      description: 'Advanced AI models including GPT-4, GPT-4o, and o4-mini',
      requiresApiKey: true,
      envVarName: 'OPENAI_API_KEY',
      isActive: true,
    },
  });

  const googleProvider = await prisma.aIProvider.upsert({
    where: { name: 'google' },
    update: {},
    create: {
      name: 'google',
      displayName: 'Google AI',
      description: 'Gemini models for multimodal AI applications',
      requiresApiKey: true,
      envVarName: 'GOOGLE_GENERATIVE_AI_API_KEY',
      isActive: true,
    },
  });

  await prisma.aIProvider.upsert({
    where: { name: 'ollama' },
    update: {},
    create: {
      name: 'ollama',
      displayName: 'Ollama',
      description: 'Local AI models running on Ollama',
      requiresApiKey: false,
      defaultBaseUrl: 'http://localhost:11434/api',
      envVarName: 'OLLAMA_BASE_URL',
      isActive: true,
    },
  });

  console.log('AI Providers seeded');

  console.log('Seeding AI Models...');

  const openaiModels = [
    {
      modelId: 'gpt-4.1',
      name: 'GPT-4.1',
      description: 'Advanced GPT-4.1 model with enhanced capabilities',
      type: 'CHAT' as const,
      maxTokens: 128000,
      supportsImages: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricing: 5,
      outputPricing: 15,
    },
    {
      modelId: 'gpt-4o',
      name: 'GPT-4o',
      description: 'Most capable multimodal model, great for complex tasks',
      type: 'CHAT' as const,
      maxTokens: 128000,
      supportsImages: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricing: 2.5,
      outputPricing: 10,
    },
    {
      modelId: 'gpt-4o-mini',
      name: 'GPT-4o Mini',
      description: 'Fast and cost-effective model for simple tasks',
      type: 'CHAT' as const,
      maxTokens: 128000,
      supportsImages: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricing: 0.15,
      outputPricing: 0.6,
    },
    {
      modelId: 'o4-mini',
      name: 'OpenAI o4 Mini',
      description: 'Faster reasoning model for coding and math',
      type: 'CHAT' as const,
      maxTokens: 128000,
      supportsImages: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricing: 3,
      outputPricing: 12,
    },
  ];

  for (const model of openaiModels) {
    await prisma.aIModel.upsert({
      where: {
        providerId_modelId: {
          providerId: openaiProvider.id,
          modelId: model.modelId,
        },
      },
      update: {},
      create: {
        ...model,
        providerId: openaiProvider.id,
      },
    });
  }

  const googleModels = [
    {
      modelId: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      description: 'Advanced multimodal Gemini model with enhanced reasoning',
      type: 'CHAT' as const,
      maxTokens: 2097152,
      supportsImages: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricing: 1.25,
      outputPricing: 5,
    },
    {
      modelId: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      description: 'Fast and cost-effective multimodal Gemini model',
      type: 'CHAT' as const,
      maxTokens: 1048576,
      supportsImages: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricing: 0.075,
      outputPricing: 0.3,
    },
  ];

  for (const model of googleModels) {
    await prisma.aIModel.upsert({
      where: {
        providerId_modelId: {
          providerId: googleProvider.id,
          modelId: model.modelId,
        },
      },
      update: {},
      create: {
        ...model,
        providerId: googleProvider.id,
      },
    });
  }

  console.log('AI Models seeded');

  console.log('Seeding users...');

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@eduai.local' },
    update: {
      name: 'EduAI Admin',
      role: 'ADMIN',
      isActive: true,
      emailVerified: true,
    },
    create: {
      email: 'admin@eduai.local',
      name: 'EduAI Admin',
      role: 'ADMIN',
      isActive: true,
      emailVerified: true,
      authorizedUnits: [],
    },
  });

  const instructorUser = await prisma.user.upsert({
    where: { email: 'instructor@eduai.local' },
    update: {
      name: 'Sample Instructor',
      role: 'INSTRUCTOR',
      isActive: true,
      emailVerified: true,
    },
    create: {
      email: 'instructor@eduai.local',
      name: 'Sample Instructor',
      role: 'INSTRUCTOR',
      isActive: true,
      emailVerified: true,
      authorizedUnits: [],
    },
  });

  console.log('Users seeded');

  console.log('Seeding courses and topics...');

  const coursesToSeed = [
    {
      code: 'COSC_O 101',
      section: '001',
      name: 'Introduction to Computer Science',
      term: 'Fall',
      year: 2024,
      startDate: new Date('2024-09-03'),
      aiInstructions:
        'Provide supportive explanations for programming fundamentals and algorithmic thinking.',
      topics: ['Programming Basics', 'Algorithms', 'Data Structures'],
    },
    {
      code: 'MATH_O 200',
      section: '001',
      name: 'Linear Algebra',
      term: 'Spring',
      year: 2025,
      startDate: new Date('2025-01-06'),
      aiInstructions:
        'Emphasize intuition behind vector spaces and practical matrix applications.',
      topics: ['Matrices', 'Vector Spaces', 'Eigenvalues & Eigenvectors'],
    },
    {
      code: 'HIST_O 210',
      section: '001',
      name: 'World History: 1500 to Present',
      term: 'Winter',
      year: 2025,
      startDate: new Date('2025-01-06'),
      aiInstructions:
        'Highlight cause-and-effect relationships and encourage critical analysis of sources.',
      topics: ['Age of Exploration', 'Industrial Revolution', 'World Wars', 'Globalization'],
    },
  ] as const;

  for (const courseData of coursesToSeed) {
    const course = await prisma.course.upsert({
      where: {
        code_startDate_section: {
          code: courseData.code,
          startDate: courseData.startDate,
          section: courseData.section,
        },
      },
      update: {
        name: courseData.name,
        term: courseData.term,
        year: courseData.year,
        aiInstructions: courseData.aiInstructions,
      },
      create: {
        code: courseData.code,
        section: courseData.section,
        name: courseData.name,
        term: courseData.term,
        year: courseData.year,
        startDate: courseData.startDate,
        aiInstructions: courseData.aiInstructions,
      },
    });

    await prisma.courseTopic.deleteMany({ where: { courseId: course.id } });
    await prisma.courseTopic.createMany({
      data: courseData.topics.map((name) => ({ courseId: course.id, name })),
    });

    await prisma.enrollment.upsert({
      where: { courseId_userId: { courseId: course.id, userId: instructorUser.id } },
      update: { role: 'INSTRUCTOR', isActive: true },
      create: {
        courseId: course.id,
        userId: instructorUser.id,
        role: 'INSTRUCTOR',
        isActive: true,
      },
    });

    console.log(
      `  ${courseData.code}-${courseData.section} (${courseData.term} ${courseData.year}) — ${courseData.topics.length} topics`,
    );
  }

  console.log('Courses seeded');

  const providerCount = await prisma.aIProvider.count();
  const modelCount = await prisma.aIModel.count();
  const courseCount = await prisma.course.count();

  console.log(`Seed complete — ${providerCount} providers, ${modelCount} models, ${courseCount} courses`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
