import { createRemoteJWKSet, jwtVerify } from 'jose';

const SUPABASE_JWKS_URL = process.env.SUPABASE_JWKS_URL;

if (!SUPABASE_JWKS_URL) {
  throw new Error('SUPABASE_JWKS_URL environment variable is required');
}

// Cache del JWKS para no fetchearlo en cada request
const JWKS = createRemoteJWKSet(new URL(SUPABASE_JWKS_URL));

export interface AuthPayload {
  sub: string;        // User ID de Supabase
  email?: string;
  role?: string;
  exp: number;
  iss: string;
}

/**
 * Verifica el JWT de Supabase usando JWKS público.
 * Lanza un error si el token es inválido, expirado o manipulado.
 *
 * NUNCA confiar en el payload sin verificar primero.
 */
export async function verifyToken(authHeader: string | null): Promise<AuthPayload> {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or malformed Authorization header');
  }

  const token = authHeader.slice(7);

  const { payload } = await jwtVerify(token, JWKS, {
    // Supabase emite tokens con el project URL como issuer
    // issuer: `${process.env.SUPABASE_URL}/auth/v1`,
  });

  if (!payload.sub) {
    throw new Error('Invalid token: missing sub');
  }

  return payload as unknown as AuthPayload;
}
