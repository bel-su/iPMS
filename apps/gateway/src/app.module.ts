import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Redis } from 'ioredis';
import { HealthController, MetricsController, registerReadinessCheck } from '@ipms/observability';
import { ProxyController } from './proxy/proxy.controller.js';
import { JwtGuard, TOKEN_VERSIONS, type TokenVersionReader } from './auth/jwt.guard.js';
import { CorrelationMiddleware } from './auth/correlation.middleware.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [ProxyController, HealthController, MetricsController],
  providers: [
    {
      // The named ioredis import is deliberate: the ESM default export is not
      // constructable under this TypeScript configuration, and
      // `new (await import('ioredis')).default(...)` fails at bootstrap. The
      // previous shape also used `require()` inside a `"type": "module"`
      // package, which throws "require is not defined".
      provide: TOKEN_VERSIONS,
      useFactory: (): TokenVersionReader => {
        const redis = new Redis(requireEnv('REDIS_URL'));

        // Authenticated traffic cannot be served correctly without this store
        // (JwtGuard fails closed when it is unreachable), so an unreachable
        // Redis must take the gateway out of rotation rather than quietly
        // reject every request.
        registerReadinessCheck('redis', async () => {
          try { return (await redis.ping()) === 'PONG'; } catch { return false; }
        });

        return {
          async read(userId: string): Promise<number | undefined> {
            // Distinguishes the three cases JwtGuard treats differently: a
            // stored version, no entry (null → undefined → refuse), and a
            // store error (ioredis throws → propagates → refuse and log).
            const raw = await redis.get(`tokenVersion:${userId}`);
            if (raw === null) return undefined;
            const parsed = Number(raw);
            return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
          },
        };
      },
    },
    { provide: APP_GUARD, useClass: JwtGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
