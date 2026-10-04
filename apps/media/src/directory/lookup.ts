import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

export type Lookup<T> =
  | { state: 'found'; value: T }
  | { state: 'not_found' }
  | { state: 'forbidden' }
  | { state: 'unavailable' };

/** The lookup as an answer, or the HTTP error that stands in for one. 503 is the phone's cue to retry later. */
export function required<T>(lookup: Lookup<T>, what: string): T {
  switch (lookup.state) {
    case 'found': return lookup.value;
    case 'not_found': throw new NotFoundException(`${what} not found`);
    case 'forbidden': throw new ForbiddenException(`You cannot access this ${what.toLowerCase()}`);
    case 'unavailable': throw new ServiceUnavailableException(`${what} could not be checked right now. Try again shortly.`);
  }
}

export async function getJson<T>(url: string, bearer: string, timeoutMs: number): Promise<Lookup<T>> {
  try {
    const response = await globalThis.fetch(url, { headers: { authorization: bearer }, signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 404) return { state: 'not_found' };
    if (response.status === 401 || response.status === 403) return { state: 'forbidden' };
    if (!response.ok) return { state: 'unavailable' };
    return { state: 'found', value: (await response.json()) as T };
  } catch {
    return { state: 'unavailable' };
  }
}
