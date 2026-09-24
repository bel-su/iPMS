import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { RequirePermission } from '@ipms/authz';
import { UuidSchema } from '@ipms/contracts';
import { TemplateQueries, type TemplateReference } from './template.queries.js';

/**
 * Service-to-service only: the gateway refuses every '/internal/' path.
 *
 * `project` calls this when a work order is created, forwarding the creating
 * user's own token, so the permission is checked against that user — the same
 * pattern as project's `internal/tasks/:id`. Everyone who may create a work
 * order already holds `qc_template.view`: they pick the template from the list.
 */
@Controller('internal/templates')
export class TemplateReferenceController {
  constructor(private readonly queries: TemplateQueries) {}

  @Get(':id') @RequirePermission('qc_template.view')
  async reference(@Param('id') id: string): Promise<TemplateReference> {
    const found = await this.queries.reference(UuidSchema.parse(id));
    if (!found) throw new NotFoundException('Checklist template not found');
    return found;
  }
}
