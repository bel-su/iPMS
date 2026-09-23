import { BadRequestException, Body, Controller, Get, Param, PayloadTooLargeException, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import { ImportCommitSchema, UuidSchema, VersionNumberSchema, type TemplateCategory } from '@ipms/contracts';
import { toDocument } from './document.js';
import { EXAMPLE_DOCUMENT, buildWorkbook } from './excel/workbook.js';
import { TemplateImportService } from './template-import.service.js';
import { TemplateQueries } from './template.queries.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sendXlsx(reply: FastifyReply, file: Buffer, filename: string): FastifyReply {
  return reply.header('content-type', XLSX).header('content-disposition', `attachment; filename="${filename}"`).send(file);
}

@Controller('qc/templates')
export class TemplateImportController {
  constructor(private readonly imports: TemplateImportService, private readonly queries: TemplateQueries) {}

  @Get('import/blank') @RequirePermission('qc_template.view')
  async blank(@Res() reply: FastifyReply) {
    return sendXlsx(reply, await buildWorkbook({ metadata: null, version: null, document: EXAMPLE_DOCUMENT }), 'checklist-template.xlsx');
  }

  @Get(':id/versions/:version/export') @RequirePermission('qc_template.view')
  async exportVersion(@Param('id') id: string, @Param('version') version: string, @Res() reply: FastifyReply) {
    const { template, version: found } = await this.queries.getVersion(UuidSchema.parse(id), VersionNumberSchema.parse(version));
    const file = await buildWorkbook({
      metadata: { code: template.code, name: template.name, category: template.category as TemplateCategory },
      version: { version: found.version, status: found.status, publishedAt: found.publishedAt },
      document: toDocument(found),
    });
    return sendXlsx(reply, file, `${template.code}-v${found.version}.xlsx`);
  }

  @Post('import/preview') @RequirePermission('qc_template.import')
  async preview(@Req() req: FastifyRequest) {
    const file = await req.file();
    if (!file) throw new BadRequestException('Attach an .xlsx file in a "file" field');
    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      throw new PayloadTooLargeException('The file is larger than 5 MB');
    }
    return this.imports.preview(buffer);
  }

  @Post('import/commit') @RequirePermission('qc_template.import')
  commit(@Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.imports.commit(ImportCommitSchema.parse(body), req.user.id);
  }
}
