import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { TaskChecklistController } from './task-checklist.controller.js';
import type { TaskLookup, TaskLookupClient } from './task-lookup.client.js';
import type { TemplateQueries } from '../templates/template.queries.js';

const TASK_ID = '0192f7a0-0000-7000-8000-000000000001';
const ENGINEER = { id: 'u-engineer', permissions: ['task.view'] };
const MANAGER = { id: 'u-manager', permissions: ['qc_template.view'] };
const TASK = { id: TASK_ID, projectId: 'p-1', siteId: 's-1', assigneeId: 'u-engineer', templateId: 'tpl-1', status: 'ONGOING' };
const TEMPLATE = { id: 'tpl-1', code: 'AI-RRU', disabledAt: null as Date | null };
const VERSION = { id: 'v-1', version: 2, sections: [] };

function setup(lookup: TaskLookup, tree: unknown = { template: TEMPLATE, version: VERSION }) {
  const tasks = { fetch: vi.fn().mockResolvedValue(lookup) };
  const queries = { currentTree: vi.fn().mockResolvedValue(tree) };
  const controller = new TaskChecklistController(tasks as unknown as TaskLookupClient, queries as unknown as TemplateQueries);
  const call = (user: { id: string; permissions: string[] }) => controller.checklist(TASK_ID, { user, headers: { authorization: 'Bearer t' } } as never);
  return { tasks, queries, call };
}

describe('GET /qc/tasks/:taskId/checklist', () => {
  it('gives the assignee the current published version', async () => {
    const { call, tasks } = setup({ state: 'found', task: TASK });
    await expect(call(ENGINEER)).resolves.toEqual({ task: { id: TASK_ID, projectId: 'p-1', siteId: 's-1' }, template: TEMPLATE, version: VERSION });
    expect(tasks.fetch).toHaveBeenCalledWith(TASK_ID, 'Bearer t');
  });

  it('lets a holder of qc_template.view preview it', async () => {
    const { call } = setup({ state: 'found', task: TASK });
    await expect(call(MANAGER)).resolves.toMatchObject({ version: VERSION });
  });

  it('refuses anyone else', async () => {
    const { call } = setup({ state: 'found', task: TASK });
    await expect(call({ id: 'u-other', permissions: ['task.view'] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('answers 404 for a task without a checklist', async () => {
    const { call } = setup({ state: 'found', task: { ...TASK, templateId: null } });
    await expect(call(ENGINEER)).rejects.toThrow('This task has no checklist assigned');
  });

  it('answers 409 for a disabled template', async () => {
    const { call } = setup({ state: 'found', task: TASK }, { template: { ...TEMPLATE, disabledAt: new Date() }, version: VERSION });
    await expect(call(ENGINEER)).rejects.toThrow('This checklist has been disabled');
  });

  it('answers 409 for a template never published', async () => {
    const { call } = setup({ state: 'found', task: TASK }, { template: TEMPLATE, version: null });
    await expect(call(ENGINEER)).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    [{ state: 'not_found' } as const, NotFoundException],
    [{ state: 'forbidden' } as const, ForbiddenException],
    [{ state: 'unavailable' } as const, ServiceUnavailableException],
  ])('passes the project answer %o through', async (lookup, type) => {
    const { call } = setup(lookup);
    await expect(call(ENGINEER)).rejects.toBeInstanceOf(type);
  });
});
