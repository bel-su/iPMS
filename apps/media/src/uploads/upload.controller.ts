import { Body, Controller, Delete, HttpCode, Param, Post, Req } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import { CompleteUploadSchema, PartsRequestSchema, RegisterUploadSchema, UploadStatusRequestSchema, UuidSchema } from '@ipms/contracts';
import { UploadService } from './upload.service.js';

type Authed = { user: AuthzUser; headers: Record<string, string | undefined> };

/** The phone's upload protocol. Declared before `:id` routes so `status` is never read as an id. */
@Controller('media')
export class UploadController {
  constructor(private readonly uploads: UploadService) {}

  @Post('uploads/status') @HttpCode(200) @RequirePermission('qc_evidence.upload')
  status(@Body() body: unknown, @Req() req: Authed) {
    return this.uploads.status(UploadStatusRequestSchema.parse(body).ids, req.user.id);
  }

  @Post('uploads') @RequirePermission('qc_evidence.upload')
  register(@Body() body: unknown, @Req() req: Authed) {
    return this.uploads.register(RegisterUploadSchema.parse(body), req.user.id, req.headers['authorization'] ?? '');
  }

  @Post('uploads/:id/parts') @HttpCode(200) @RequirePermission('qc_evidence.upload')
  parts(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.uploads.parts(UuidSchema.parse(id), PartsRequestSchema.parse(body).partNumbers, req.user.id);
  }

  @Post('uploads/:id/complete') @HttpCode(200) @RequirePermission('qc_evidence.upload')
  complete(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.uploads.complete(UuidSchema.parse(id), CompleteUploadSchema.parse(body ?? {}), req.user.id);
  }

  @Delete(':id') @RequirePermission('qc_evidence.upload')
  discard(@Param('id') id: string, @Req() req: Authed) {
    return this.uploads.discard(UuidSchema.parse(id), req.user.id);
  }
}
