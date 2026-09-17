import { z } from 'zod';
import { UuidSchema } from '../common/ids.js';

/**
 * Deliberately uses .strip() rather than z.strictObject(): in Zod 4,
 * strictObject() *throws* on unrecognized keys instead of dropping them,
 * which would let a malformed-but-otherwise-valid request fail outright
 * while still round-tripping attacker-supplied keys through the error
 * payload. Stripping silently discards a client-supplied `role` or
 * `permissions` claim so it can never reach the handler.
 */
export const LoginSchema = z.object({
  username: z.string().min(1).max(150),
  password: z.string().min(8).max(200),
}).strip();
export type LoginDto = z.infer<typeof LoginSchema>;

/** Deliberately strict: scope lists are never embedded in the token. */
export const TokenPayloadSchema = z.object({
  sub: UuidSchema,
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  tokenVersion: z.number().int().nonnegative(),
  iat: z.number().int(),
  exp: z.number().int(),
}).strip();
export type TokenPayload = z.infer<typeof TokenPayloadSchema>;

export const TokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

export const RefreshSchema = z.strictObject({ refreshToken: z.string().min(1) });
export type RefreshDto = z.infer<typeof RefreshSchema>;
