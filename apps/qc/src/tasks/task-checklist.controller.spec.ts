import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TaskChecklistController } from './task-checklist.controller.js';
import type { PrismaService } from '../prisma.service.js';
import type { TemplateQueries } from '../templates/template.queries.js';

const TASK_ID = '0192f7a0-0000-7000-8000-000000000001';
const ENGINEER = { id: 'u-engineer', permissions: ['task.view'] };
const MANAGER = { id: 'u-manager', permissions: ['qc_template.view'] };
const ORDER = { id: TASK_ID, projectId: 'p-1', siteId: 's-1', assigneeId: 'u-engineer', templateId: 'tpl-1' };
const TEMPLATE = { id: 'tpl-1', code: 'AI-RRU', disabledAt: null as Date | null };
const VERSION = { id: 'v-1', version: 2, sections: [] };

function setup(order: typeof ORDER | null, tree: unknown = { template: TEMPLATE, version: VERSION }) {
  const prisma = { db: { workOrder: { findUnique: vi.fn().mockResolvedValue(order) } } };
  const queries = { currentTree: vi.fn().mockResolvedValue(tree) };
  const controller = new TaskChecklistController(prisma as unknown as PrismaService, queries as unknown as TemplateQueries);
  const call = (user: { id: string; permissions: string[] }) => controller.checklist(TASK_ID, { user } as never);
  return { queries, call };
}

describe('GET /qc/tasks/:taskId/checklist', () => {
  it('gives the assignee the current published version', async () => {
    const { call, queries } = setup(ORDER);
    await expect(call(ENGINEER)).resolves.toEqual({ task: { id: TASK_ID, projectId: 'p-1', siteId: 's-1' }, template: TEMPLATE, version: VERSION });
    expect(queries.currentTree).toHaveBeenCalledWith('tpl-1');
  });

  it('lets a holder of qc_template.view preview it', async () => {
    const { call } = setup(ORDER);
    await expect(call(MANAGER)).resolves.toMatchObject({ version: VERSION });
  });

  it('refuses anyone else', async () => {
    const { call } = setup(ORDER);
    await expect(call({ id: 'u-other', permissions: ['task.view'] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('answers 404 for an unknown work order', async () => {
    const { call } = setup(null);
    await expect(call(ENGINEER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 409 for a disabled template', async () => {
    const { call } = setup(ORDER, { template: { ...TEMPLATE, disabledAt: new Date() }, version: VERSION });
    await expect(call(ENGINEER)).rejects.toThrow('This checklist has been disabled');
  });

  it('answers 409 for a template never published', async () => {
    const { call } = setup(ORDER, { template: TEMPLATE, version: null });
    await expect(call(ENGINEER)).rejects.toBeInstanceOf(ConflictException);
  });
});
