import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { RequirePermission } from '@ipms/authz';
import { AttachRequestSchema, FinanceAttachRequestSchema, MediaCheckRequestSchema } from '@ipms/contracts';
import { AttachService } from './attach.service.js';

/**
 * Service-to-service only: the gateway refuses every `/media/internal/` path.
 * qc calls this at submit with the submitting engineer's own token.
 */
@Controller('media/internal')
export class AttachController {
  constructor(private readonly attachments: AttachService) {}

  @Post('attach') @HttpCode(200) @RequirePermission('qc_submission.submit')
  attach(@Body() body: unknown) {
    return this.attachments.attach(AttachRequestSchema.parse(body));
  }

  /** finance's invoice files, checked and attached the same way, by the requester's own token. */
  @Post('finance/attach') @HttpCode(200) @RequirePermission('finance_request.create')
  attachFinance(@Body() body: unknown) {
    return this.attachments.attachFinance(FinanceAttachRequestSchema.parse(body));
  }

  @Post('finance/check') @HttpCode(200) @RequirePermission('finance_request.create')
  checkFinance(@Body() body: unknown) {
    return this.attachments.checkFinance(FinanceAttachRequestSchema.parse(body));
  }

  /** Read-only: whether each file could be attached right now, and its kind. */
  @Post('check') @HttpCode(200) @RequirePermission('qc_submission.submit')
  check(@Body() body: unknown) {
    return this.attachments.check(MediaCheckRequestSchema.parse(body));
  }
}
