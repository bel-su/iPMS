import { createHash, randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, api, waitForReady } from './helpers/stack.js';

async function login(user: string): Promise<string> {
  const res = await api<{ accessToken: string }>('/api/v1/auth/login', { method: 'POST', body: { email: `${user}@ipms.local`, password: DEMO_PASSWORD } });
  expect(res.status).toBe(201);
  return res.body.accessToken;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** UUIDv7 made the way the phone makes it. */
function uuidv7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
// Smallest valid JPEG header + filler: enough for the sniff; sharp will reject it, so we assert that path too.
const jpegLike = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2000)]);

let admin: string;
let engineer: string;
let engineerId: string;
beforeAll(async () => {
  await waitForReady();
  [admin, engineer] = await Promise.all([login('admin'), login('engineer')]);
  engineerId = (await api<{ items: { id: string }[] }>('/api/v1/users?search=engineer', { token: admin })).body.items[0]!.id;
}, 90_000);

describe('media', () => {
  it('register → upload to storage → complete → verified outcome → cleanup', async () => {
    const stamp = Date.now();
    const created = await api<{ templateId: string }>('/api/v1/qc/templates', { method: 'POST', token: admin, body: { code: `MED-${stamp}`, name: 'E2E media', category: 'QUALITY' } });
    const templateId = created.body.templateId;
    await api(`/api/v1/qc/templates/${templateId}/draft`, { method: 'PUT', token: admin, body: { revision: 1, document: { sections: [{ number: '1', title: 'Photos', items: [{ number: '1.1', requirementText: 'Label', minPhotos: 1, maxPhotos: 2 }] }] } } });
    await api(`/api/v1/qc/templates/${templateId}/publish`, { method: 'POST', token: admin });
    const projectId = (await api<{ id: string }>('/api/v1/projects', { method: 'POST', token: admin, body: { code: `MED-${stamp}`, name: 'Media e2e' } })).body.id;
    const siteId = (await api<{ id: string }>(`/api/v1/projects/${projectId}/sites`, { method: 'POST', token: admin, body: { siteCode: 'KOS121', name: 'KOS121' } })).body.id;
    const scope = { level: 'PROJECT', projectId };
    await api(`/api/v1/users/${engineerId}/projects`, { method: 'POST', token: admin, body: scope });
    let workOrderId = '';
    try {
      await sleep(1500); // scope replicates to project over NATS
      const made = await api<{ created: { id: string }[] }>('/api/v1/work-orders', { method: 'POST', token: admin, body: {
        projectId, workOrderType: 'QUALITY_SELF_CHECK', templateId, siteIds: [siteId], assigneeId: engineerId, plannedCompletionAt: '2026-12-31T18:14:59Z',
      } });
      workOrderId = made.body.created[0]!.id;

      const id = uuidv7();
      const registration = {
        id, category: 'EVIDENCE', workOrderId, checklistItemId: uuidv7(), kind: 'PHOTO', contentType: 'image/jpeg',
        sizeBytes: jpegLike.length, contentHash: createHash('sha256').update(jpegLike).digest('hex'),
        capturedAt: new Date().toISOString(), deviceId: 'e2e',
      };
      const registered = await api<{ status: string; upload: { mode: string; signedUrl: string; headers: Record<string, string> } }>('/api/v1/media/uploads', { method: 'POST', token: engineer, body: registration });
      expect(registered.status).toBe(201);
      expect(registered.body.upload.mode).toBe('single');

      const put = await fetch(registered.body.upload.signedUrl, { method: 'PUT', body: jpegLike, headers: registered.body.upload.headers });
      expect(put.status).toBe(200);
      expect((await api(`/api/v1/media/uploads/${id}/complete`, { method: 'POST', token: engineer, body: {} })).status).toBe(200);

      // The worker polls every second. Random bytes after a JPEG marker cannot be decoded, so the honest outcome is REJECTED.
      let status = 'VERIFYING';
      for (let i = 0; i < 20 && status === 'VERIFYING'; i++) {
        await sleep(500);
        status = (await api<{ status: string }[]>('/api/v1/media/uploads/status', { method: 'POST', token: engineer, body: { ids: [id] } })).body[0]!.status;
      }
      expect(status).toBe('REJECTED');

      // Internal routes stay off the edge.
      expect((await api('/api/v1/media/internal/attach', { method: 'POST', token: admin, body: {} })).status).toBe(404);

      // Leave nothing behind in storage.
      expect((await api(`/api/v1/media/${id}`, { method: 'DELETE', token: engineer })).status).toBe(200);
    } finally {
      if (workOrderId) await api(`/api/v1/work-orders/${workOrderId}/cancel`, { method: 'POST', token: admin, body: { reason: 'e2e cleanup' } });
      await api(`/api/v1/users/${engineerId}/projects`, { method: 'DELETE', token: admin, body: scope });
    }
  }, 90_000);
});
