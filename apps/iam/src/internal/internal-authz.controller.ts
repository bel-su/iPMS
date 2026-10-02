import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Public } from '@ipms/authz';
import { HoldersRequestSchema, type HoldersResult } from '@ipms/contracts';
import { EffectiveService } from '../effective/effective.service.js';
import { InternalKeyGuard } from './internal-key.guard.js';

/**
 * Service-to-service only: the gateway refuses every `/internal/` path.
 *
 * `@Public()` bypasses the user-token guard, because the caller is an event
 * consumer with no user; `@UseGuards(InternalKeyGuard)` replaces it. Both sit
 * on the class, so a route added here later cannot end up with neither.
 */
@Public()
@UseGuards(InternalKeyGuard)
@Controller('internal/authz')
export class InternalAuthzController {
  constructor(private readonly effective: EffectiveService) {}

  @Post('holders')
  @HttpCode(200)
  async holders(@Body() body: unknown): Promise<HoldersResult> {
    const { permission, projectId } = HoldersRequestSchema.parse(body);
    return { userIds: await this.effective.holders(permission, projectId) };
  }
}
