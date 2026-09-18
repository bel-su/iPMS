import { Body, Controller, Get, Post, Req, UnauthorizedException } from '@nestjs/common';
import { LoginSchema, RefreshSchema, type TokenPair } from '@ipms/contracts';
import type { AuthzUser } from '@ipms/authz';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  async login(@Body() body: unknown): Promise<TokenPair> {
    return this.auth.login(LoginSchema.parse(body));
  }

  @Post('refresh')
  async refresh(@Body() body: unknown): Promise<TokenPair> {
    return this.auth.refresh(RefreshSchema.parse(body).refreshToken);
  }

  @Post('logout')
  async logout(@Req() req: { user?: AuthzUser }): Promise<{ status: 'ok' }> {
    if (!req.user) throw new UnauthorizedException('Authentication required');
    await this.auth.revokeAll(req.user.id);
    return { status: 'ok' };
  }

  @Get('me')
  async me(@Req() req: { user?: AuthzUser }): Promise<AuthzUser> {
    if (!req.user) throw new UnauthorizedException('Authentication required');
    return req.user;
  }
}
