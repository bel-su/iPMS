import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { RequirePermission } from '@ipms/authz';
import { AttachRequestSchema } from '@ipms/contracts';
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
}
