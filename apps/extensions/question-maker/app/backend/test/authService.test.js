/**
 * Unit tests for JWT verification in authService (no database).
 */
import jwt from 'jsonwebtoken';
import { verifyToken } from '../src/services/authService.js';
import { config } from '../src/config/settings.js';

describe('verifyToken', () => {
  it('returns payload for a valid token', () => {
    const token = jwt.sign(
      { userId: 42, email: 'a@b.c' },
      config.jwtSecret,
      { expiresIn: '1h' }
    );
    const payload = verifyToken(token);
    expect(payload.userId).toBe(42);
    expect(payload.email).toBe('a@b.c');
  });

  it('throws for an invalid token', () => {
    expect(() => verifyToken('not-a-jwt')).toThrow();
  });

  it('throws for a token signed with a different secret', () => {
    const token = jwt.sign({ userId: 1 }, 'other-secret', { expiresIn: '1h' });
    expect(() => verifyToken(token)).toThrow();
  });
});
