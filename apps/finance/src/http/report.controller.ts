import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import { ReportQuerySchema } from '@ipms/contracts';
import type { FastifyReply } from 'fastify';
import { ProjectDirectoryClient, required } from '../directory/project-directory.client.js';
import { ReportService } from '../queries/report.service.js';
import { buildSpendWorkbook } from '../queries/report.xlsx.js';

type Authed = { user: AuthzUser; headers: Record<string, string | undefined> };

@Controller('finance/reports')
export class ReportController {
  constructor(private readonly reports: ReportService, private readonly projects: ProjectDirectoryClient) {}

  /** Spend per project, category or engineer, as JSON or an Excel file (`?format=xlsx`). */
  @Get('project-spend') @RequirePermission('finance_request.view_all')
  async spend(@Query() query: unknown, @Req() req: Authed, @Res({ passthrough: true }) reply: FastifyReply) {
    const parsed = ReportQuerySchema.parse(query);
    const scope = required(await this.projects.scope(req.headers['authorization'] ?? ''), 'Scope');
    const rows = await this.reports.spend(req.user, scope, parsed);
    if (parsed.format === 'json') return rows;
    reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="finance-spend-by-${parsed.groupBy}.xlsx"`);
    return buildSpendWorkbook(rows);
  }
}
