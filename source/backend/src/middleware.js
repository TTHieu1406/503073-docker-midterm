import { ZodError } from 'zod';
import { config } from './config.js';
import { HttpError } from './lib/errors.js';
import { verifyToken } from './lib/token.js';
import { logger } from './logger.js';
import { httpDuration, httpRequests } from './metrics.js';

export const AUTH_COOKIE = 'dockmart_token';
export const stats = { requests: 0 };

/** Tags every response with the replica that produced it. */
export function identify(_req, res, next) {
  res.setHeader('X-Served-By', config.instanceId);
  res.setHeader('X-App-Version', config.version);
  next();
}

export function observe(req, res, next) {
  const stopTimer = httpDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    stopTimer({ method: req.method, route });
    httpRequests.inc({ method: req.method, route, status: res.statusCode });
    // originalUrl, because Express removes the mount path from req.path inside a router.
    if (req.originalUrl.startsWith('/api')) stats.requests += 1;
  });
  next();
}

export function loadUser(req, _res, next) {
  const token = req.cookies?.[AUTH_COOKIE];
  if (token) {
    try {
      req.user = verifyToken(token, config.jwtSecret);
    } catch {
      req.user = undefined;
    }
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) throw new HttpError(401, 'Please sign in first.');
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) throw new HttpError(401, 'Please sign in first.');
  if (req.user.role !== 'admin') throw new HttpError(403, 'Administrators only.');
  next();
}

export function notFound(_req, _res, next) {
  next(new HttpError(404, 'Not found.'));
}

// Express recognises error handlers by their four arguments.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    const [issue] = err.issues;
    return res.status(400).json({ error: `${issue.path.join('.') || 'input'}: ${issue.message}` });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  logger.error({ err, path: req.path }, 'unhandled error');
  return res.status(500).json({ error: 'Something went wrong on our side.' });
}
