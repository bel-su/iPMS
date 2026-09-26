import { z } from 'zod';
import { UuidSchema } from '../common/ids.js';

// Convention: every request DTO in this file strips unknown keys rather than
// rejecting, so an out-of-date offline client cannot be hard-failed by a
// field it does not know about.

/**
 * Deliberately uses .strip() rather than z.strictObject(): in Zod 4,
 * strictObject() *throws* on unrecognized keys instead of dropping them,
 * which would let a malformed-but-otherwise-valid request fail outright
 * while still round-tripping attacker-supplied keys through the error
 * payload. Stripping silently discards a client-supplied `role` or
 * `permissions` claim so it can never reach the handler.
 */
export const LoginSchema = z.object({
  /**
   * Normalized exactly as `EmailSchema` stores it, but not held to the email
   * format: a malformed address simply matches no account, and answering it
   * with the generic failure reveals less than a validation error would.
   */
  email: z.string().trim().toLowerCase().min(1).max(255),
  password: z.string().min(8).max(200),
}).strip();
export type LoginDto = z.infer<typeof LoginSchema>;

/** Access tokens are short-lived and authorize requests; refresh tokens only mint new pairs. */
export const TokenTypeSchema = z.enum(['access', 'refresh']);
export type TokenType = z.infer<typeof TokenTypeSchema>;

/**
 * Strips unknown keys, same as every DTO in this file. That is enough on its
 * own: scope lists (e.g. `siteIds`) are never embedded in the token, so any
 * such key sent in is simply discarded rather than round-tripped.
 *
 * `typ` is required and is NOT optional-and-stripped. Both token kinds are
 * signed with the same HMAC secret and differ only in lifetime — 15 minutes
 * against 30 days — so this claim is the only thing that stops a stolen
 * refresh token from being presented as an access token and accepted for a
 * month. Every verifier must assert the kind it expects; see
 * `verifyToken(token, secret, expectedType)` in @ipms/authz, which is the one
 * implementation all services share.
 */
export const TokenPayloadSchema = z.object({
  sub: UuidSchema,
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  tokenVersion: z.number().int().nonnegative(),
  typ: TokenTypeSchema,
  /**
   * Present and true only while the holder owes a password change. A token
   * carrying it is minted with no roles and no permissions, so every
   * `AuthzGuard` in the platform refuses it — that is what makes the forced
   * change an enforced rule rather than a browser-side suggestion.
   *
   * Optional so that tokens minted before this field existed still verify:
   * this schema strips undeclared keys, so an absent claim is absent, not
   * invalid.
   */
  mustChangePassword: z.boolean().optional(),
  iat: z.number().int(),
  exp: z.number().int(),
}).strip();
export type TokenPayload = z.infer<typeof TokenPayloadSchema>;

export const TokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
  /** Lets the web app send the user straight to the change-password page at login. */
  mustChangePassword: z.boolean().optional(),
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

export const RefreshSchema = z.object({ refreshToken: z.string().min(1) }).strip();
export type RefreshDto = z.infer<typeof RefreshSchema>;
