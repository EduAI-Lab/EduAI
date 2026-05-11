/**
 * Auth router handling registration, login, and profile endpoints for the Question Maker backend.
 * Validates incoming payloads, delegates to authService, and applies authentication middleware where required.
 */
import express from 'express';
import { registerUser, loginUser, getUserById } from '../services/authService.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

/** POST /api/auth/register – creates a user after validating email/password requirements. */
router.post('/register', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long'
      });
    }

    const result = await registerUser({ email, password });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/auth/login – verifies credentials and returns JWT/user payload on success. */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    const result = await loginUser({ email, password });

    res.json({
      success: true,
      message: 'Login successful',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/auth/me – fetches the authenticated user profile using the JWT on the request. */
router.get('/me', authenticateToken, async (req, res, next) => {
  try {
    const user = await getUserById(req.user.id);

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    next(error);
  }
});

export default router;
