export interface TemplateRef {
  id: string; code: string; name: string; category: string;
  disabled: boolean; publishedVersion: number | null;
}

export type TemplateLookup =
  | { state: 'found'; template: TemplateRef }
  | { state: 'not_found' }
  | { state: 'forbidden' }
  | { state: 'unavailable' };

/**
 * Asks qc about a checklist template, forwarding the caller's own bearer token
 * so qc checks their permission and no shared service secret is needed — the
 * mirror of qc's `TaskLookupClient`.
 *
 * A failure cannot degrade gracefully: a work order saved against a template
 * nobody could verify is the unvalidated reference this lookup exists to stop.
 */
export class TemplateLookupClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 3000) {}

  async fetch(templateId: string, bearer: string): Promise<TemplateLookup> {
    try {
      const response = await globalThis.fetch(`${this.baseUrl}/api/v1/internal/templates/${templateId}`, {
        headers: { authorization: bearer },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 404) return { state: 'not_found' };
      if (response.status === 401 || response.status === 403) return { state: 'forbidden' };
      if (!response.ok) return { state: 'unavailable' };
      return { state: 'found', template: (await response.json()) as TemplateRef };
    } catch {
      return { state: 'unavailable' };
    }
  }
}
