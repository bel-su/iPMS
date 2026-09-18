import { Body, Controller, Get, Post, Req, UnauthorizedException } from '@nestjs/common';
import { LoginSchema, RefreshSchema, type TokenPair } from '@ipms/contracts';
import { Public, type AuthzUser } from '@ipms/authz';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Unauthenticated by necessity — this is where a caller with no token gets
   * one. `JwtUserGuard` is registered as an APP_GUARD, so without `@Public()`
   * it rejects the login request before the handler runs and no one can ever
   * authenticate. Same for `refresh`, which is redeemed precisely when the
   * access token has expired.
   */
  @Public()
  @Post('login')
  async login(@Body() body: unknown): Promise<TokenPair> {
    return this.auth.login(LoginSchema.parse(body));
  }

  @Public()
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
