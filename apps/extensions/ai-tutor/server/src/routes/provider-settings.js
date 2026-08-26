import express from 'express';
import {
  deleteUserProviderSetting,
  getUserProviderSettings,
  upsertUserProviderSetting,
} from '../services/eduaiClient.js';

const router = express.Router();

function cookieFor(req) {
  return typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
}

router.get('/provider-settings', async (req, res, next) => {
  try {
    res.json(await getUserProviderSettings(cookieFor(req)));
  } catch (error) {
    next(error);
  }
});

router.post('/provider-settings', async (req, res, next) => {
  const { providerName, isEnabled, apiKey, baseUrl } = req.body ?? {};
  if (typeof providerName !== 'string' || !providerName.trim()) {
    return res.status(400).json({ error: 'providerName is required' });
  }
  if (typeof isEnabled !== 'boolean') {
    return res.status(400).json({ error: 'isEnabled must be a boolean' });
  }
  if (apiKey !== undefined && typeof apiKey !== 'string') {
    return res.status(400).json({ error: 'apiKey must be a string' });
  }
  if (baseUrl !== undefined && typeof baseUrl !== 'string') {
    return res.status(400).json({ error: 'baseUrl must be a string' });
  }

  try {
    const result = await upsertUserProviderSetting(cookieFor(req), {
      providerName: providerName.trim(),
      isEnabled,
      ...(apiKey !== undefined ? { apiKey } : {}),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
    });
    if (result === null) return res.status(204).end();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.delete('/provider-settings', async (req, res, next) => {
  const providerName = typeof req.query.providerName === 'string' ? req.query.providerName.trim() : '';
  if (!providerName) return res.status(400).json({ error: 'providerName is required' });
  try {
    await deleteUserProviderSetting(cookieFor(req), providerName);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
