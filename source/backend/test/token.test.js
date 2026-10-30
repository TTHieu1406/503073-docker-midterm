import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import { signToken, verifyToken } from '../src/lib/token.js';

const user = { id: 7, name: 'Linh', email: 'linh@example.com', role: 'customer' };
const secret = 'test-secret-with-enough-length-to-be-realistic';

describe('session tokens', () => {
  it('round-trips the user', () => {
    assert.deepEqual(verifyToken(signToken(user, secret), secret), user);
  });

  it('rejects a token signed with another key', () => {
    assert.throws(() => verifyToken(signToken(user, 'another-key'), secret), /invalid signature/);
  });

  it('rejects unsigned tokens', () => {
    const forged = jwt.sign({ sub: '1', role: 'admin' }, '', { algorithm: 'none' });
    assert.throws(() => verifyToken(forged, secret));
  });
});
