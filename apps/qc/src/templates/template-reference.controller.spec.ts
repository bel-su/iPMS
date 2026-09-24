import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PERMISSION_KEY, type PermissionMetadata } from '@ipms/authz';
import { TemplateReferenceController } from './template-reference.controller.js';
import type { TemplateQueries } from './template.queries.js';

const ID = '0192f7a0-0000-7000-8000-000000000001';

function controller(reference: unknown) {
  const queries = { reference: vi.fn().mockResolvedValue(reference) };
  return { queries, controller: new TemplateReferenceController(queries as unknown as TemplateQueries) };
}

describe('TemplateReferenceController', () => {
  it('requires qc_template.view', () => {
    const handler = TemplateReferenceController.prototype.reference as unknown as object;
    expect((Reflect.getMetadata(PERMISSION_KEY, handler) as PermissionMetadata).permission).toBe('qc_template.view');
  });

  it('returns the reference', async () => {
    const ref = { id: ID, code: 'Q1', name: 'Q', category: 'QUALITY', disabled: false, publishedVersion: 2 };
    const { controller: c } = controller(ref);
    await expect(c.reference(ID)).resolves.toEqual(ref);
  });

  it('answers 404 for an unknown template', async () => {
    const { controller: c } = controller(null);
    await expect(c.reference(ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a malformed id before querying', async () => {
    const { controller: c, queries } = controller(null);
    await expect(c.reference('nope')).rejects.toThrow();
    expect(queries.reference).not.toHaveBeenCalled();
  });
});
