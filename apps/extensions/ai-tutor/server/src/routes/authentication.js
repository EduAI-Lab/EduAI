import express from 'express';
import { toPublicUser } from '../utils/mappers.js';

const router = express.Router();

// Return the current authenticated user based on Better Auth session
router.get('/me', async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: 'Authentication required' });
  res.json({ user: toPublicUser(authUser) });
});

export default router;
