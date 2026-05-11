/**
 * Authentication service for registering users, verifying credentials, and issuing JWTs.
 * Encapsulates password hashing, duplicate checks, and helper lookups for the auth routes.
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../schema/index.js';
import { config } from '../config/settings.js';
import { seedCoursesForNewUser } from './seedNewUserService.js';
import { isBugReportAdminEmail } from './bugReportService.js';

/** Shape returned to clients from login/register/me (no secrets). */
function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    createdDate: user.createdDate ?? user.createdAt,
    isBugReportAdmin: isBugReportAdminEmail(user.email)
  };
}

/** Creates a user with hashed credentials and returns a JWT/user payload. */
async function registerUser(userData) {
  const { email, password } = userData;

  // Check if user already exists
  const existingUser = await User.findOne({ where: { email } });
  if (existingUser) {
    throw new Error('User with this email already exists');
  }

  // Hash password
  const saltRounds = 12;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  // Create user
  const user = await User.create({
    email,
    passwordHash,
  });

  // Seed default courses with topics and sample questions for the new user
  await seedCoursesForNewUser(user.id);

  // Generate JWT token
  const token = jwt.sign(
    { userId: user.id, email: user.email },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );

  return {
    user: toPublicUser(user),
    token,
  };
}

/** Verifies credentials for an existing user and returns a JWT/user payload. */
async function loginUser(credentials) {
  const { email, password } = credentials;

  // Find user
  const user = await User.findOne({ where: { email } });
  if (!user) {
    throw new Error('Invalid email or password');
  }

  // Verify password
  const isValidPassword = await bcrypt.compare(password, user.passwordHash);
  if (!isValidPassword) {
    throw new Error('Invalid email or password');
  }

  // Generate JWT token
  const token = jwt.sign(
    { userId: user.id, email: user.email },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );

  return {
    user: toPublicUser(user),
    token,
  };
}

/** Validates a JWT and returns the decoded payload or throws on failure. */
function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

/** Fetches a user by primary key and returns a safe subset of fields. */
async function getUserById(userId) {
  const user = await User.findByPk(userId);
  if (!user) {
    throw new Error('User not found');
  }

  return toPublicUser(user);
}

export {
  registerUser,
  loginUser,
  verifyToken,
  getUserById,
};
