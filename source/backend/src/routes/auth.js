import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { signToken } from '../lib/token.js';
import { AUTH_COOKIE, requireAuth } from '../middleware.js';

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().max(120).toLowerCase(),
  password: z.string().min(8).max(72),
});

const loginSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(1).max(72),
});

function startSession(res, user) {
  res.cookie(AUTH_COOKIE, signToken(user, config.jwtSecret), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
  });
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}

authRouter.post('/register', async (req, res) => {
  const input = registerSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(input.password, 10);
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, name, email, role`,
    [input.name, input.email, passwordHash],
  );
  if (rows.length === 0) throw new HttpError(409, 'That email address is already registered.');
  res.status(201);
  startSession(res, rows[0]);
});

authRouter.post('/login', async (req, res) => {
  const input = loginSchema.parse(req.body);
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [input.email]);
  const user = rows[0];
  const matches = user && (await bcrypt.compare(input.password, user.password_hash));
  if (!matches) throw new HttpError(401, 'Incorrect email or password.');
  startSession(res, user);
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
