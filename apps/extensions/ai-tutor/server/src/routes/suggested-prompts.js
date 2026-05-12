import express from 'express';
import { prisma } from '../config/database.js';

const router = express.Router();

/**
 * GET /api/suggested-prompts
 * Returns active suggested prompts grouped by mode (teach/guide)
 */
router.get('/suggested-prompts', async (req, res) => {
  try {
    const prompts = await prisma.suggestedPrompt.findMany({
      where: { isActive: true },
      orderBy: [{ mode: 'asc' }, { position: 'asc' }],
      select: {
        id: true,
        mode: true,
        text: true,
      },
    });

    res.json(prompts);
  } catch (error) {
    console.error('Failed to load suggested prompts:', error);
    res.status(500).json({ error: 'Failed to load suggested prompts' });
  }
});

export default router;
