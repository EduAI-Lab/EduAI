import express from 'express';
import { prisma } from '../config/database.js';
import { requireRole } from '../middleware/auth.js';

const router = express.Router();

function createPromptSlug(name) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'prompt'
  );
}

async function resolveUniquePromptSlug(name) {
  const baseSlug = createPromptSlug(name);
  const matches = await prisma.promptTemplate.findMany({
    where: {
      slug: {
        startsWith: baseSlug,
      },
    },
    select: { slug: true },
  });

  const existing = new Set(matches.map((match) => match.slug));
  if (!existing.has(baseSlug)) {
    return baseSlug;
  }

  let suffix = 2;
  while (existing.has(`${baseSlug}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseSlug}-${suffix}`;
}

router.get('/prompts', requireRole('PROFESSOR'), async (req, res) => {
  try {
    const prompts = await prisma.promptTemplate.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    res.json(prompts);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post('/prompts', requireRole('PROFESSOR'), async (req, res) => {
  const { name, systemPrompt, temperature, topP } = req.body || {};

  if (!name || !systemPrompt) {
    return res.status(400).json({ error: 'name and systemPrompt are required' });
  }

  try {
    const slug = await resolveUniquePromptSlug(name);
    const prompt = await prisma.promptTemplate.create({
      data: {
        name,
        slug,
        systemPrompt,
        temperature: typeof temperature === 'number' ? temperature : null,
        topP: typeof topP === 'number' ? topP : null,
      },
    });
    res.status(201).json(prompt);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
