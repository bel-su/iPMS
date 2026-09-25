import argon2 from 'argon2';

/**
 * Argon2id hashing, as plain functions with no framework coupling.
 *
 * Separate from `PasswordService` so the Prisma seed — a standalone script —
 * can hash with exactly these parameters without importing a `@Injectable()`
 * class and dragging @nestjs/common into its module graph. The parameters must
 * live in one place: a seed that hashed with different memory or time costs
 * would produce credentials this service could still verify, but at a
 * different work factor than every password set through the API.
 *
 * OWASP-recommended argon2id parameters: 19 MiB memory, 2 iterations, 1 lane.
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

/**
 * Returns false rather than throwing on a malformed stored hash: a corrupt or
 * legacy row must fail the login, not surface as a 500 that tells the caller
 * the email exists.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
