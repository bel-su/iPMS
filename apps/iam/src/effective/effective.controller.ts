import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequirePermission } from '@ipms/authz';
import { AccessCheckSchema, UuidSchema, type AccessCheckResult, type EffectivePermission } from '@ipms/contracts';
import { EffectiveService } from './effective.service.js';

@Controller()
export class EffectiveController {
  constructor(private readonly effective: EffectiveService) {}

  @Get('users/:id/effective-permissions')
  @RequirePermission('user.view')
  async forUser(@Param('id') id: string): Promise<EffectivePermission[]> {
    return this.effective.forUser(UuidSchema.parse(id));
  }

  @Post('access/check')
  @RequirePermission('access.simulate')
  async simulate(@Body() body: unknown): Promise<AccessCheckResult> {
    return this.effective.simulate(AccessCheckSchema.parse(body));
  }
}
