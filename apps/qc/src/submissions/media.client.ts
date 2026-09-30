import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { AttachRequestDto, MediaCheckRequestDto, MediaCheckResult } from '@ipms/contracts';

/**
 * media's internal evidence endpoints, called at submit with the submitting
 * engineer's own token, so media applies their permission.
 *
 * Nothing degrades here: a submission whose evidence cannot be checked is not
 * accepted. 503 tells the phone to keep it queued and retry.
 */
export class MediaClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 5000) {}

  async check(body: MediaCheckRequestDto, bearer: string): Promise<MediaCheckResult[]> {
    try {
      const response = await this.post('/api/v1/media/internal/check', body, bearer);
      // Still under the request timeout: a body that stalls or is not JSON lands in the catch.
      const results: unknown = await response.json();
      if (!Array.isArray(results)) throw unavailable();
      return results as MediaCheckResult[];
    } catch (err) {
      // check is read-only, so a 409 is as unexpected as any other odd reply.
      throw err instanceof ForbiddenException || err instanceof ServiceUnavailableException ? err : unavailable();
    }
  }

  /** `refused`: some file changed since the check. */
  async attach(body: AttachRequestDto, bearer: string): Promise<'attached' | 'refused'> {
    try {
      await this.post('/api/v1/media/internal/attach', body, bearer);
      return 'attached';
    } catch (err) {
      if (err instanceof Refused) return 'refused';
      throw err;
    }
  }

  private async post(path: string, body: unknown, bearer: string): Promise<Response> {
    let response: Response;
    try {
      response = await globalThis.fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { authorization: bearer, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw unavailable();
    }
    if (response.ok) return response;
    // Release the connection: an unread error body keeps its socket out of the pool.
    await response.body?.cancel().catch(() => {});
    if (response.status === 409) throw new Refused();
    if (response.status === 401 || response.status === 403) throw new ForbiddenException('You cannot submit evidence for this work order');
    throw unavailable();
  }
}

class Refused extends Error {}
const unavailable = () => new ServiceUnavailableException('Evidence could not be checked right now. Try again shortly.');
