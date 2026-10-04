import { createHash, timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

export const INTERNAL_KEY_HEADER = 'x-internal-key';

/** Hashing first makes the comparison constant-length, so `timingSafeEqual` never throws on a length mismatch. */
const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * Authenticates service-to-service calls that have no user token to forward,
 * such as an event consumer asking who may review a project.
 *
 * Fails closed: with no key configured it refuses every call, and in
 * production it refuses to start. The gateway already refuses every
 * `/internal/` path; this is the second lock, so a gateway regression does not
 * expose the endpoint.
 */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  private readonly expected: Buffer | null;

  constructor() {
    const key = process.env['INTERNAL_SERVICE_KEY'];
    if (!key && process.env['NODE_ENV'] === 'production') throw new Error('INTERNAL_SERVICE_KEY is not set');
    this.expected = key ? digest(key) : null;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const given = request.headers[INTERNAL_KEY_HEADER];
    if (this.expected === null || typeof given !== 'string' || !timingSafeEqual(digest(given), this.expected)) {
      throw new UnauthorizedException('Authentication required');
    }
    return true;
  }
}
