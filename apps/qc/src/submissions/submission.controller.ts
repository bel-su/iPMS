import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import { CreateSubmissionSchema, ReviewSubmissionSchema, UuidSchema } from '@ipms/contracts';
import { SubmissionService } from './submission.service.js';

@Controller('qc/submissions')
export class SubmissionController {
  constructor(private readonly service: SubmissionService) {}

  @Get(':id') @RequirePermission('qc_submission.view')
  get(@Param('id') id: string) { return this.service.getSubmission(UuidSchema.parse(id)); }

  @Post() @RequirePermission('qc_submission.create')
  submit(@Body() body: unknown, @Req() req: { user: AuthzUser; headers: Record<string, string | undefined> }) {
    return this.service.createSubmission(CreateSubmissionSchema.parse(body), req.user.id, req.headers['authorization'] ?? '');
  }

  @Post(':id/review') @RequirePermission('qc_review.approve')
  review(@Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.service.reviewSubmission(UuidSchema.parse(id), ReviewSubmissionSchema.parse(body), req.user.id);
  }
}
