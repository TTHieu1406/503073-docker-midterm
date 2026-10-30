import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readSecret } from '../src/config.js';

describe('readSecret', () => {
  it('prefers the mounted secret file and trims the newline', () => {
    const env = { DB_PASSWORD_FILE: '/run/secrets/db', DB_PASSWORD: 'from-env' };
    assert.equal(readSecret('DB_PASSWORD', env, () => 'from-file\n'), 'from-file');
  });

  it('falls back to the plain variable', () => {
    assert.equal(readSecret('DB_PASSWORD', { DB_PASSWORD: 'from-env' }), 'from-env');
  });

  it('refuses to start in production without the secret', () => {
    assert.throws(() => readSecret('JWT_SECRET', { NODE_ENV: 'production' }), /Missing required secret/);
  });

  it('uses a clearly marked value during development', () => {
    assert.equal(readSecret('JWT_SECRET', { NODE_ENV: 'development' }), 'dev-only-jwt_secret');
  });
});
