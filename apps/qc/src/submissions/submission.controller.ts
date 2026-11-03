import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { RequirePermission, extractToken, type AuthzUser } from '@ipms/authz';
import { CreateSubmissionSchema, ReviewSubmissionSchema, UuidSchema } from '@ipms/contracts';
import { ProjectDirectoryClient, required } from '../work-orders/project-directory.client.js';
import { SubmissionService } from './submission.service.js';

@Controller('qc/submissions')
export class SubmissionController {
  constructor(private readonly service: SubmissionService, private readonly projects: ProjectDirectoryClient) {}

  @Get(':id') @RequirePermission('qc_submission.view')
  async get(@Param('id') id: string, @Req() req: { headers: Record<string, string | string[] | undefined> }) {
    const parsed = UuidSchema.parse(id);
    const token = extractToken(req);
    // Scoped like work orders: a submission on a site the caller cannot see reads as not found.
    return this.service.getSubmission(parsed, required(await this.projects.scope(token ? `Bearer ${token}` : ''), 'Scope'));
  }

  @Post() @RequirePermission('qc_submission.create')
  submit(@Body() body: unknown, @Req() req: { user: AuthzUser; headers: Record<string, string | string[] | undefined> }) {
    const token = extractToken(req);
    return this.service.createSubmission(CreateSubmissionSchema.parse(body), req.user.id, token ? `Bearer ${token}` : '');
  }

  @Post(':id/review') @RequirePermission('qc_review.approve')
  async review(@Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthzUser; headers: Record<string, string | string[] | undefined> }) {
    const parsed = UuidSchema.parse(id);
    const dto = ReviewSubmissionSchema.parse(body);
    const token = extractToken(req);
    // Scoped like `get`: a reviewer cannot decide a submission on a site they cannot see.
    return this.service.reviewSubmission(parsed, dto, req.user.id, required(await this.projects.scope(token ? `Bearer ${token}` : ''), 'Scope'));
  }
}
