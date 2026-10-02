import { HoldersResultSchema } from '@ipms/contracts';

/**
 * What notification needs to know from iam: who may do a thing in a project.
 *
 * Authenticated with the shared service key, not a user token, because the
 * caller is an event consumer. Every failure throws: the consumer lets that
 * propagate so JetStream redelivers, and a lookup that quietly returned an
 * empty list would drop the notification instead.
 */
export class IamDirectoryClient {
  constructor(
    private readonly baseUrl: string,
    private readonly key: string,
    private readonly timeoutMs = 3000,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  async holders(permission: string, projectId: string): Promise<string[]> {
    const response = await (this.fetchImpl ?? globalThis.fetch)(`${this.baseUrl}/api/v1/internal/authz/holders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': this.key },
      body: JSON.stringify({ permission, projectId }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`iam holders lookup failed with ${response.status}`);
    return HoldersResultSchema.parse(await response.json()).userIds;
  }
}
