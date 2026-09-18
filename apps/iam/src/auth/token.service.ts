import { Injectable } from '@nestjs/common';
import { signToken, verifyToken } from '@ipms/authz';
import type { TokenPair, TokenPayload } from '@ipms/contracts';

export interface TokenConfig {
  secret: string;
  accessTtl: number;
  refreshTtl: number;
}

/**
 * iam is the only issuer of tokens in the platform, so signing lives here —
 * but the signing and verification *algorithm* does not. Both come from
 * @ipms/authz, which every service and the gateway also use. Writing a second
 * HMAC implementation in this file is what let the `typ` claim go unchecked at
 * the gateway once already; if the format needs to change, change it there and
 * every verifier changes with it.
 */
@Injectable()
export class TokenService {
  constructor(private readonly config: TokenConfig) {}

  /** The longest a token from this service can live — the TTL a session record must outlast. */
  get refreshTtlSeconds(): number {
    return this.config.refreshTtl;
  }

  issue(
    user: { id: string; tokenVersion: number },
    roles: string[],
    permissions: string[],
  ): TokenPair {
    const claims = { sub: user.id, roles, permissions, tokenVersion: user.tokenVersion };
    return {
      accessToken: signToken(claims, 'access', this.config.secret, this.config.accessTtl),
      refreshToken: signToken(claims, 'refresh', this.config.secret, this.config.refreshTtl),
      expiresIn: this.config.accessTtl,
    };
  }

  verifyAccess(token: string): TokenPayload {
    return verifyToken(token, this.config.secret, 'access');
  }

  verifyRefresh(token: string): TokenPayload {
    return verifyToken(token, this.config.secret, 'refresh');
  }
}
