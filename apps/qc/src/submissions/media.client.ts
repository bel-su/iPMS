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
    const response = await this.post('/api/v1/media/internal/check', body, bearer);
    return (await response.json()) as MediaCheckResult[];
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
    if (response.status === 409) throw new Refused();
    if (response.status === 401 || response.status === 403) throw new ForbiddenException('You cannot submit evidence for this work order');
    throw unavailable();
  }
}

class Refused extends Error {}
const unavailable = () => new ServiceUnavailableException('Evidence could not be checked right now. Try again shortly.');
