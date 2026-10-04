import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import { SaveDraftSchema, TakeoverDraftSchema, UuidSchema } from '@ipms/contracts';
import { DraftService } from './draft.service.js';

type Authed = { user: AuthzUser };

/** The assignee's server-side draft, for switching devices. See DraftService. */
@Controller('work-orders/:id/draft')
export class DraftController {
  constructor(private readonly drafts: DraftService) {}

  @Get() @RequirePermission('qc_submission.update')
  get(@Param('id') id: string, @Req() req: Authed) {
    return this.drafts.get(UuidSchema.parse(id), req.user.id);
  }

  @Put() @RequirePermission('qc_submission.update')
  save(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.drafts.save(UuidSchema.parse(id), SaveDraftSchema.parse(body), req.user.id);
  }

  @Post('takeover') @HttpCode(200) @RequirePermission('qc_submission.update')
  takeover(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.drafts.takeover(UuidSchema.parse(id), TakeoverDraftSchema.parse(body), req.user.id);
  }
}
