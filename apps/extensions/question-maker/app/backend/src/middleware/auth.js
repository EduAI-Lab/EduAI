/**
 * Express middleware utilities for authenticating requests via JWT and issuing tokens.
 * Ensures downstream routes have `req.user` populated and provides a helper for generating signed tokens.
 */
import jwt from 'jsonwebtoken';
import { User } from '../schema/User.js';
import { config } from '../config/settings.js';

/**
 * Validates the Bearer token, loads the corresponding user, and attaches it to the request.
 * Rejects missing/expired/invalid tokens with appropriate 401 responses before hitting protected routes.
 */
export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access token required'
      });
    }

    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await User.findByPk(decoded.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token - user not found'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired'
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

/** Generates a signed JWT for the given user ID using the configured secret and expiry. */
export const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};
