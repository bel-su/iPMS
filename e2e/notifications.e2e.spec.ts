import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, api, waitForReady } from './helpers/stack.js';

async function login(user: string): Promise<string> {
  const res = await api<{ accessToken: string }>('/api/v1/auth/login', { method: 'POST', body: { email: `${user}@ipms.local`, password: DEMO_PASSWORD } });
  expect(res.status).toBe(201);
  return res.body.accessToken;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function uuidv7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

interface Page { items: { id: string; type: string; title: string; body: string; actionUrl: string | null; workOrderId: string | null; isRead: boolean }[]; nextCursor: string | null }

/** The consumers run asynchronously after the outbox drains, so poll rather than assert once. */
async function waitForNotification(token: string, workOrderId: string, type: string): Promise<Page['items'][number]> {
  for (let i = 0; i < 30; i++) {
    const page = await api<Page>('/api/v1/notifications?limit=50', { token });
    const found = page.body.items.find((n) => n.workOrderId === workOrderId && n.type === type);
    if (found) return found;
    await sleep(500);
  }
  throw new Error(`no ${type} notification for ${workOrderId} within 15s`);
}

let admin: string;
let qc: string;
let engineer: string;
let engineerId: string;
let qcId: string;

beforeAll(async () => {
  await waitForReady();
  [admin, qc, engineer] = await Promise.all([login('admin'), login('qc'), login('engineer')]);
  engineerId = (await api<{ items: { id: string }[] }>('/api/v1/users?search=engineer', { token: admin })).body.items[0]!.id;
  qcId = (await api<{ items: { id: string; email: string }[] }>('/api/v1/users?search=qc@ipms.local', { token: admin })).body.items.find((u) => u.email === 'qc@ipms.local')!.id;
}, 90_000);

describe('QC notifications', () => {
  it('tells reviewers on submit and the engineer on a rework decision, to each recipient only', async () => {
    const stamp = Date.now();
    const templateId = (await api<{ templateId: string }>('/api/v1/qc/templates', { method: 'POST', token: qc, body: { code: `NT-${stamp}`, name: 'E2E notifications', category: 'QUALITY' } })).body.templateId;
    // No photo or video minimums, so the submission needs no uploads.
    await api(`/api/v1/qc/templates/${templateId}/draft`, { method: 'PUT', token: qc, body: { revision: 1, document: { sections: [{ number: '1', title: 'Install', items: [{ number: '1.1', requirementText: 'Label fitted' }] }] } } });
    expect((await api(`/api/v1/qc/templates/${templateId}/publish`, { method: 'POST', token: qc })).status).toBe(201);
    const projectId = (await api<{ id: string }>('/api/v1/projects', { method: 'POST', token: admin, body: { code: `NT-${stamp}`, name: 'Notifications e2e' } })).body.id;
    const siteId = (await api<{ id: string }>(`/api/v1/projects/${projectId}/sites`, { method: 'POST', token: admin, body: { siteCode: 'KOS131', name: 'KOS131' } })).body.id;
    const scope = { level: 'PROJECT', projectId };
    await api(`/api/v1/users/${engineerId}/projects`, { method: 'POST', token: admin, body: scope });
    await api(`/api/v1/users/${qcId}/projects`, { method: 'POST', token: admin, body: scope });
    try {
      await sleep(1500); // scope replicates to project over NATS
      const workOrderId = (await api<{ created: { id: string }[] }>('/api/v1/work-orders', { method: 'POST', token: admin, body: {
        projectId, workOrderType: 'QUALITY_SELF_CHECK', templateId, siteIds: [siteId], assigneeId: engineerId, plannedCompletionAt: '2026-12-31T18:14:59Z',
      } })).body.created[0]!.id;
      const checklist = await api<{ version: { id: string; sections: { items: { id: string }[] }[] } }>(`/api/v1/qc/tasks/${workOrderId}/checklist`, { token: engineer });
      const itemId = checklist.body.version.sections[0]!.items[0]!.id;

      const submitted = await api<{ id: string }>('/api/v1/qc/submissions', { method: 'POST', token: engineer, body: {
        taskId: workOrderId, siteId, projectId, templateVersionId: checklist.body.version.id, idempotencyKey: `e2e-${uuidv7()}`,
        responses: [{ itemId, selfCheckResult: 'PASS', mediaIds: [] }],
      } });
      expect(submitted.status).toBe(201);

      // The reviewer is told; the submitter is not told about their own submission.
      const forReviewer = await waitForNotification(qc, workOrderId, 'QC_SUBMISSION_SUBMITTED');
      expect(forReviewer.title).toBe('Submission awaiting review');
      expect(forReviewer.actionUrl).toBe(`/quality/work-orders/${workOrderId}`);
      expect(forReviewer.isRead).toBe(false);
      const engineerSeesSubmitted = await api<Page>('/api/v1/notifications?limit=50', { token: engineer });
      expect(engineerSeesSubmitted.body.items.some((n) => n.workOrderId === workOrderId && n.type === 'QC_SUBMISSION_SUBMITTED')).toBe(false);

      // Reject: the engineer is told, with the reviewer's comment.
      const review = await api(`/api/v1/qc/submissions/${submitted.body.id}/review`, { method: 'POST', token: qc, body: { decision: 'REJECT_REWORK', comment: 'Label is crooked', itemReviews: [{ itemId, result: 'REJECTED' }] } });
      expect(review.status).toBe(201);
      const rework = await waitForNotification(engineer, workOrderId, 'QC_SUBMISSION_REJECTED');
      expect(rework.title).toBe('Rework required');
      expect(rework.body).toContain('Label is crooked');

      // Recipient isolation: the reviewer cannot read or mark the engineer's notification.
      expect((await api(`/api/v1/notifications/${rework.id}/read`, { method: 'POST', token: qc })).status).toBe(404);
      const reviewerPage = await api<Page>('/api/v1/notifications?limit=50', { token: qc });
      expect(reviewerPage.body.items.some((n) => n.id === rework.id)).toBe(false);

      // Read state: unread count drops by one and the row reads as read.
      const before = (await api<{ count: number }>('/api/v1/notifications/unread-count', { token: engineer })).body.count;
      expect((await api(`/api/v1/notifications/${rework.id}/read`, { method: 'POST', token: engineer })).status).toBe(204);
      expect((await api<{ count: number }>('/api/v1/notifications/unread-count', { token: engineer })).body.count).toBe(before - 1);
      expect((await api(`/api/v1/notifications/${rework.id}/read`, { method: 'POST', token: engineer })).status).toBe(204); // idempotent
      const unreadOnly = await api<Page>('/api/v1/notifications?unreadOnly=true&limit=50', { token: engineer });
      expect(unreadOnly.body.items.some((n) => n.id === rework.id)).toBe(false);
    } finally {
      await api(`/api/v1/users/${engineerId}/projects`, { method: 'DELETE', token: admin, body: scope });
      await api(`/api/v1/users/${qcId}/projects`, { method: 'DELETE', token: admin, body: scope });
    }
  }, 120_000);

  it('refuses a notification request with no token', async () => {
    expect((await api('/api/v1/notifications/unread-count')).status).toBe(401);
  });

  it('refuses the internal holders lookup at the gateway, even for an admin with a valid body', async () => {
    // A valid token gets past the JWT guard, so only a gateway /internal/ block yields 404 (IAM itself would answer 401/403/422).
    const res = await api('/api/v1/internal/authz/holders', { method: 'POST', token: admin, body: { permission: 'qc_review.approve', projectId: uuidv7() } });
    expect(res.status).toBe(404);
  });
});
