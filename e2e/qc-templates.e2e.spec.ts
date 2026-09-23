import { beforeAll, describe, expect, it } from 'vitest';
import { api, waitForReady } from './helpers/stack.js';

const BASE = process.env['E2E_GATEWAY_URL'] ?? 'http://localhost:3000';
const PASSWORD = process.env['IAM_DEMO_PASSWORD'] ?? 'demo12345';

async function login(username: string): Promise<string> {
  const res = await api<{ accessToken: string }>('/api/v1/auth/login', { method: 'POST', body: { username, password: PASSWORD } });
  expect(res.status).toBe(201);
  return res.body.accessToken;
}

let qc: string;

beforeAll(async () => { await waitForReady(); qc = await login('qc'); }, 90_000);

describe('checklist template lifecycle', () => {
  it('create → save → publish → export → import the export → publish v2', async () => {
    const code = `E2E-${Date.now()}`;
    const created = await api<{ templateId: string }>('/api/v1/qc/templates', { method: 'POST', token: qc, body: { code, name: 'E2E', category: 'QUALITY' } });
    expect(created.status).toBe(201);
    const id = created.body.templateId;

    const document = { sections: [{ number: '1', title: 'EHS', items: [{ number: '1.1', requirementText: 'PPE worn', severity: 'CRITICAL', minPhotos: 1, maxPhotos: 2 }] }] };
    expect((await api(`/api/v1/qc/templates/${id}/draft`, { method: 'PUT', token: qc, body: { revision: 1, document } })).status).toBe(200);
    expect((await api(`/api/v1/qc/templates/${id}/publish`, { method: 'POST', token: qc })).status).toBe(201);

    const exported = await fetch(`${BASE}/api/v1/qc/templates/${id}/versions/1/export`, { headers: { authorization: `Bearer ${qc}` } });
    expect(exported.status).toBe(200);
    const form = new FormData();
    form.set('file', new Blob([await exported.arrayBuffer()]), 'export.xlsx');
    const previewRes = await fetch(`${BASE}/api/v1/qc/templates/import/preview`, { method: 'POST', headers: { authorization: `Bearer ${qc}` }, body: form });
    const preview = await previewRes.json() as { errors: unknown[]; target: unknown; metadata: object; document: object };
    expect(preview.errors).toEqual([]);
    expect(preview.target).toMatchObject({ kind: 'EXISTING', templateId: id, nextVersion: 2 });

    const committed = await api<{ draft: { version: number } }>('/api/v1/qc/templates/import/commit', { method: 'POST', token: qc, body: { ...preview.metadata, document: preview.document } });
    expect(committed.body.draft.version).toBe(2);
    expect((await api(`/api/v1/qc/templates/${id}/publish`, { method: 'POST', token: qc })).status).toBe(201);

    const detail = await api<{ versions: { version: number; status: string }[] }>(`/api/v1/qc/templates/${id}`, { token: qc });
    expect(detail.body.versions.map((v) => [v.version, v.status])).toEqual([[2, 'PUBLISHED'], [1, 'RETIRED']]);
  });

  it('keeps field engineers out of the library', async () => {
    const engineer = await login('engineer');
    expect((await api('/api/v1/qc/templates', { token: engineer })).status).toBe(403);
  });

  it('answers a validation failure with field paths', async () => {
    const res = await api<{ error: { code: string; details: Record<string, string> } }>('/api/v1/qc/templates', { method: 'POST', token: qc, body: { code: 'bad code', name: 'x', category: 'QUALITY' } });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toHaveProperty('code');
  });
});
