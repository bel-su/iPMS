import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import { ListMediaQuerySchema, UuidSchema, ViewUrlQuerySchema } from '@ipms/contracts';
import { required } from '../directory/lookup.js';
import { ProjectClient } from '../directory/project.client.js';
import { ViewService } from './view.service.js';

type Authed = { user: AuthzUser; headers: Record<string, string | undefined> };

@Controller('media')
export class ViewController {
  constructor(private readonly views: ViewService, private readonly project: ProjectClient) {}

  @Get(':id/url') @RequirePermission('qc_submission.view')
  async url(@Param('id') id: string, @Query() query: unknown, @Req() req: Authed) {
    const { variant } = ViewUrlQuerySchema.parse(query);
    return this.views.url(UuidSchema.parse(id), variant, await this.scope(req));
  }

  @Get() @RequirePermission('qc_submission.view')
  async list(@Query() query: unknown, @Req() req: Authed) {
    const { workOrderId } = ListMediaQuerySchema.parse(query);
    return this.views.listForWorkOrder(workOrderId, await this.scope(req));
  }

  private async scope(req: Authed) {
    return required(await this.project.scope(req.headers['authorization'] ?? ''), 'Access scope');
  }
}
