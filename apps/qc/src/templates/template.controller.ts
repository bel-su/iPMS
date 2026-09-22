import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import {
  CreateTemplateSchema, ListTemplatesQuerySchema, SaveDraftSchema, UpdateTemplateSchema,
  UuidSchema, VersionNumberSchema,
} from '@ipms/contracts';
import { TemplateQueries } from './template.queries.js';
import { TemplateService } from './template.service.js';

type Authed = { user: AuthzUser };

@Controller('qc/templates')
export class TemplateController {
  constructor(private readonly templates: TemplateService, private readonly queries: TemplateQueries) {}

  @Get() @RequirePermission('qc_template.view')
  list(@Query() query: unknown) { return this.queries.list(ListTemplatesQuerySchema.parse(query)); }

  @Get(':id') @RequirePermission('qc_template.view')
  get(@Param('id') id: string) { return this.queries.get(UuidSchema.parse(id)); }

  @Get(':id/versions/:version') @RequirePermission('qc_template.view')
  getVersion(@Param('id') id: string, @Param('version') version: string) {
    return this.queries.getVersion(UuidSchema.parse(id), VersionNumberSchema.parse(version));
  }

  @Post() @RequirePermission('qc_template.create')
  create(@Body() body: unknown, @Req() req: Authed) { return this.templates.create(CreateTemplateSchema.parse(body), req.user.id); }

  @Patch(':id') @RequirePermission('qc_template.update')
  rename(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.templates.rename(UuidSchema.parse(id), UpdateTemplateSchema.parse(body), req.user.id);
  }

  @Post(':id/draft') @RequirePermission('qc_template.update')
  startDraft(@Param('id') id: string, @Req() req: Authed) { return this.templates.startDraft(UuidSchema.parse(id), req.user.id); }

  @Put(':id/draft') @RequirePermission('qc_template.update')
  saveDraft(@Param('id') id: string, @Body() body: unknown) {
    return this.templates.saveDraft(UuidSchema.parse(id), SaveDraftSchema.parse(body));
  }

  @Delete(':id/draft') @RequirePermission('qc_template.update')
  discardDraft(@Param('id') id: string, @Req() req: Authed) { return this.templates.discardDraft(UuidSchema.parse(id), req.user.id); }

  @Post(':id/publish') @RequirePermission('qc_template.publish')
  publish(@Param('id') id: string, @Req() req: Authed) { return this.templates.publish(UuidSchema.parse(id), req.user.id); }

  @Post(':id/disable') @RequirePermission('qc_template.publish')
  disable(@Param('id') id: string, @Req() req: Authed) { return this.templates.disable(UuidSchema.parse(id), req.user.id); }

  @Post(':id/enable') @RequirePermission('qc_template.publish')
  enable(@Param('id') id: string, @Req() req: Authed) { return this.templates.enable(UuidSchema.parse(id), req.user.id); }
}
