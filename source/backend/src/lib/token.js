import jwt from 'jsonwebtoken';

const TOKEN_LIFETIME = '8h';

/**
 * Sessions are stateless JWTs, so no replica holds session data and any replica
 * can serve any request. This is what makes the API safe to scale horizontally.
 */
export function signToken(user, secret) {
  return jwt.sign({ sub: String(user.id), name: user.name, email: user.email, role: user.role }, secret, {
    expiresIn: TOKEN_LIFETIME,
  });
}

export function verifyToken(token, secret) {
  const claims = jwt.verify(token, secret, { algorithms: ['HS256'] });
  return { id: Number(claims.sub), name: claims.name, email: claims.email, role: claims.role };
}
