import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { FinanceAttachRequestDto, MediaCheckResult } from '@ipms/contracts';

/** What finance asks of media about a request's invoice files. */
export interface InvoiceFiles {
  check(body: FinanceAttachRequestDto, bearer: string): Promise<MediaCheckResult[]>;
  /** `refused`: a file changed since the check. */
  attach(body: FinanceAttachRequestDto, bearer: string): Promise<'attached' | 'refused'>;
}

const unavailable = () => new ServiceUnavailableException('Invoice files could not be checked right now. Try again shortly.');

class Refused extends Error {}

/**
 * media's internal endpoints for invoice files, called at submit with the
 * requester's own token so media applies their permission, as qc does for
 * evidence. Nothing degrades: a request whose files cannot be checked is not
 * submitted, and 503 tells the phone to try again.
 */
export class MediaClient implements InvoiceFiles {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 5000) {}

  async check(body: FinanceAttachRequestDto, bearer: string): Promise<MediaCheckResult[]> {
    try {
      const response = await this.post('/api/v1/media/internal/finance/check', body, bearer);
      const results: unknown = await response.json();
      if (!Array.isArray(results)) throw unavailable();
      return results as MediaCheckResult[];
    } catch (err) {
      throw err instanceof ForbiddenException || err instanceof ServiceUnavailableException ? err : unavailable();
    }
  }

  async attach(body: FinanceAttachRequestDto, bearer: string): Promise<'attached' | 'refused'> {
    try {
      await this.post('/api/v1/media/internal/finance/attach', body, bearer);
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
    await response.body?.cancel().catch(() => {});
    if (response.status === 409) throw new Refused();
    if (response.status === 401 || response.status === 403) throw new ForbiddenException('You cannot attach files to this request');
    throw unavailable();
  }
}
