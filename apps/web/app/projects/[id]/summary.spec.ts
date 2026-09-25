import { describe, expect, it } from 'vitest';
import type { CurrentUser } from '../../lib/iam-api';
import type { ProjectDetail, Task } from '../../lib/project-api';
import { landingFor, myTasks, summarizeProject } from './summary';

const NOW = new Date('2026-09-23T06:00:00Z');

function user(permissions: string[], isActive = true): CurrentUser {
  return { id: 'u-1', roles: [], permissions, tokenVersion: 0, isActive };
}

function site(id: string, region: string | null, status: 'PLANNED' | 'IN_DELIVERY' = 'IN_DELIVERY') {
  return {
    id, projectId: 'p-1', regionId: region, siteCode: id.toUpperCase(), name: id, latitude: null, longitude: null,
    geofenceMode: 'INHERIT' as const, geofenceRadiusM: null, address: null, city: null, area: null, scopeVariant: null,
    status, region: region ? { id: region, projectId: 'p-1', name: region } : null,
  };
}

function project(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 'p-1', code: 'P1', name: 'Phase 1', clientName: null, phase: null, status: 'ACTIVE',
    startDate: null, targetDate: null, defaultGeofenceRadiusM: null, createdAt: '', updatedAt: '',
    sites: [site('s1', 'Koshi'), site('s2', 'Koshi'), site('s3', null, 'PLANNED')],
    taskTypes: [],
    milestones: [
      { id: 'm1', projectId: 'p-1', code: 'SV', name: 'Survey', kind: 'PROJECT', sequence: 1, targetDate: null, requirements: [{ milestoneId: 'm1', taskTypeId: 'survey' }] },
      { id: 'm2', projectId: 'p-1', code: 'CW', name: 'Civil', kind: 'PROJECT', sequence: 2, targetDate: '2026-09-01T00:00:00Z', requirements: [{ milestoneId: 'm2', taskTypeId: 'civil' }] },
    ],
    _count: { tasks: 0 },
    ...overrides,
  };
}

let seq = 0;
function task(siteId: string, taskTypeId: string, status: Task['status'], extra: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `t-${seq}`, projectId: 'p-1', siteId, taskTypeId, templateId: null, workOrderType: null, templateName: null, title: `${taskTypeId} at ${siteId}`,
    status, assigneeId: null, plannedCompletionAt: null, actualCompletionAt: null, currentSubmissionId: null,
    currentAttemptNo: null, cancelReason: null, origin: 'PLANNED', createdBy: 'u-0', createdAt: '2026-09-01T00:00:00Z', ...extra,
  };
}

describe('landingFor', () => {
  it('gives the overview to anyone who may see milestones', () => {
    expect(landingFor(user(['project.view', 'milestone.view']))).toBe('overview');
  });

  it('gives a field engineer their tasks', () => {
    expect(landingFor(user(['project.view', 'site.view', 'task.view', 'task.update']))).toBe('tasks');
  });

  it('does not trust the claim of a deactivated account', () => {
    expect(landingFor(user(['milestone.view'], false))).toBe('tasks');
  });
});

describe('summarizeProject', () => {
  it('counts a site towards a milestone only when every required task type there is completed', () => {
    const summary = summarizeProject(project(), [
      task('s1', 'survey', 'COMPLETED'),
      task('s2', 'survey', 'COMPLETED'),
      task('s1', 'civil', 'COMPLETED'),
      task('s3', 'survey', 'REVIEWING'),
    ], NOW);

    expect(summary.milestones.map((m) => [m.name, m.percent])).toEqual([['Survey', 67], ['Civil', 33]]);
    expect(summary.sitesComplete).toBe(1);
    expect(summary.completion).toBe(33);
  });

  // A work order is raised against a checklist, not a task type, so it has none to credit.
  it('does not count a completed work order towards any milestone', () => {
    const summary = summarizeProject(project(), [
      task('s1', 'survey', 'COMPLETED'),
      task('s2', 'ignored', 'COMPLETED', { taskTypeId: null, workOrderType: 'QUALITY_SELF_CHECK' }),
    ], NOW);
    expect(summary.milestones.map((m) => [m.name, m.percent])).toEqual([['Survey', 33], ['Civil', 0]]);
  });

  it('marks a milestone past its target date as overdue until every site meets it', () => {
    const summary = summarizeProject(project(), [task('s1', 'civil', 'COMPLETED')], NOW);
    expect(summary.milestones[1]).toMatchObject({ label: 'Overdue', tone: 'amber' });
    expect(summary.milestones[0]).toMatchObject({ label: 'Not started', tone: 'slate' });
  });

  it('falls back to task completion when no milestone declares requirements', () => {
    const summary = summarizeProject(project({ milestones: [] }), [task('s1', 'x', 'COMPLETED'), task('s2', 'x', 'ONGOING')], NOW);
    expect(summary.sitesComplete).toBeNull();
    expect(summary.completion).toBe(50);
  });

  it('ignores cancelled tasks', () => {
    const summary = summarizeProject(project(), [task('s1', 'x', 'CANCELLED'), task('s1', 'x', 'COMPLETED')], NOW);
    expect(summary.taskCount).toBe(1);
    expect(summary.openTaskCount).toBe(0);
  });

  it('ranks rework before review before overdue before due soon, and leaves the rest out', () => {
    const summary = summarizeProject(project(), [
      task('s1', 'a', 'ONGOING', { plannedCompletionAt: '2026-09-24T00:00:00Z' }),
      task('s1', 'b', 'NOT_STARTED', { plannedCompletionAt: '2026-09-20T00:00:00Z' }),
      task('s2', 'c', 'REVIEWING'),
      task('s3', 'd', 'RECTIFYING'),
      task('s3', 'e', 'ONGOING', { plannedCompletionAt: '2026-10-30T00:00:00Z' }),
      task('s3', 'f', 'COMPLETED', { plannedCompletionAt: '2026-09-01T00:00:00Z' }),
    ], NOW);

    expect(summary.attention.map((a) => a.status)).toEqual(['Action needed', 'Review', 'Overdue', 'Due soon']);
    expect(summary.attention[0]?.siteCode).toBe('S3');
    expect(summary.attentionTotal).toBe(4);
  });

  it('lists upcoming deadlines soonest first, excluding overdue and closed work', () => {
    const summary = summarizeProject(project(), [
      task('s1', 'a', 'ONGOING', { plannedCompletionAt: '2026-10-05T00:00:00Z' }),
      task('s1', 'b', 'ONGOING', { plannedCompletionAt: '2026-09-25T00:00:00Z' }),
      task('s1', 'c', 'ONGOING', { plannedCompletionAt: '2026-09-01T00:00:00Z' }),
      task('s1', 'd', 'COMPLETED', { plannedCompletionAt: '2026-09-26T00:00:00Z' }),
    ], NOW);
    expect(summary.deadlines.map((d) => [d.title, d.inDays])).toEqual([['b at s1', 2], ['a at s1', 12]]);
  });

  it('reports task completion per region, with unregioned sites grouped together', () => {
    const summary = summarizeProject(project(), [
      task('s1', 'a', 'COMPLETED'), task('s2', 'a', 'ONGOING'), task('s3', 'a', 'ONGOING'),
    ], NOW);
    expect(summary.regions).toEqual([
      { name: 'Koshi', sites: 2, percent: 50 },
      { name: 'No region', sites: 1, percent: 0 },
    ]);
  });
});

describe('myTasks', () => {
  it("keeps only the engineer's own tasks, rework first and undated work last within a status", () => {
    const mine = { assigneeId: 'u-1' };
    const tasks = [
      task('s1', 'a', 'COMPLETED', mine),
      task('s1', 'b', 'ONGOING', mine),
      task('s1', 'c', 'ONGOING', { ...mine, plannedCompletionAt: '2026-09-30T00:00:00Z' }),
      task('s1', 'd', 'RECTIFYING', mine),
      task('s1', 'e', 'RECTIFYING', { assigneeId: 'someone-else' }),
    ];
    expect(myTasks(tasks, 'u-1').map((t) => t.taskTypeId)).toEqual(['d', 'c', 'b', 'a']);
  });
});
