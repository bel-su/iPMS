import { describe, expect, it, afterEach } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Module, Controller, Get, Post, Put, Patch, Delete } from '@nestjs/common';

@Controller('api/v1/test')
class TestCorsController {
  @Get()
  get() { return { method: 'GET' }; }

  @Post()
  post() { return { method: 'POST' }; }

  @Put()
  put() { return { method: 'PUT' }; }

  @Patch()
  patch() { return { method: 'PATCH' }; }

  @Delete()
  del() { return { method: 'DELETE' }; }
}

@Module({
  controllers: [TestCorsController],
})
class TestCorsModule {}

describe('Gateway CORS Configuration (apps/gateway/src/main.ts)', () => {
  let app: NestFastifyApplication;

  async function createNestGateway(corsOrigins: string = 'http://localhost:3100') {
    app = await NestFactory.create<NestFastifyApplication>(
      TestCorsModule,
      new FastifyAdapter(),
      { logger: false },
    );

    // Exact configuration from apps/gateway/src/main.ts:94-98
    app.enableCors({
      origin: corsOrigins.split(','),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    });

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return app;
  }

  afterEach(async () => {
    await app?.close();
  });

  describe('Preflight OPTIONS Requests', () => {
    it('handles preflight OPTIONS for PUT with standard headers', async () => {
      const server = await createNestGateway();
      const res = await server.inject({
        method: 'OPTIONS',
        url: '/api/v1/test',
        headers: {
          origin: 'http://localhost:3100',
          'access-control-request-method': 'PUT',
          'access-control-request-headers': 'content-type,authorization',
        },
      });

      expect(res.statusCode).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3100');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-methods']).toContain('PUT');
      expect(res.headers['access-control-allow-headers']).toBe('content-type,authorization');
    });

    it('handles preflight OPTIONS for GET, POST, PATCH, and DELETE', async () => {
      const server = await createNestGateway();
      for (const verb of ['GET', 'POST', 'PATCH', 'DELETE']) {
        const res = await server.inject({
          method: 'OPTIONS',
          url: '/api/v1/test',
          headers: {
            origin: 'http://localhost:3100',
            'access-control-request-method': verb,
          },
        });

        expect(res.statusCode).toBe(204);
        expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3100');
        expect(res.headers['access-control-allow-methods']).toContain(verb);
      }
    });

    it('rejects or ignores unauthorized origins in preflight requests', async () => {
      const server = await createNestGateway();
      const res = await server.inject({
        method: 'OPTIONS',
        url: '/api/v1/test',
        headers: {
          origin: 'http://unauthorized-attacker.com',
          'access-control-request-method': 'PUT',
        },
      });

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('rejects malformed preflight (OPTIONS with Origin but no Access-Control-Request-Method) with 400 per CORS spec', async () => {
      const server = await createNestGateway();
      const res = await server.inject({
        method: 'OPTIONS',
        url: '/api/v1/test',
        headers: {
          origin: 'http://localhost:3100',
        },
      });

      // Per W3C CORS specification, an OPTIONS request carrying an Origin header is a preflight
      // and MUST include Access-Control-Request-Method. @fastify/cors rejects missing method with 400.
      expect(res.statusCode).toBe(400);
      expect(res.payload).toContain('Invalid Preflight Request');
    });

    it('does not allow non-configured HTTP verbs (e.g. TRACE)', async () => {
      const server = await createNestGateway();
      const res = await server.inject({
        method: 'OPTIONS',
        url: '/api/v1/test',
        headers: {
          origin: 'http://localhost:3100',
          'access-control-request-method': 'TRACE',
        },
      });

      const allowedMethods = res.headers['access-control-allow-methods'];
      expect(allowedMethods).not.toContain('TRACE');
    });
  });

  describe('Actual HTTP Request Processing with CORS', () => {
    it('sets CORS headers on actual PUT request', async () => {
      const server = await createNestGateway();
      const res = await server.inject({
        method: 'PUT',
        url: '/api/v1/test',
        headers: {
          origin: 'http://localhost:3100',
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ updated: true }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3100');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(JSON.parse(res.payload)).toEqual({ method: 'PUT' });
    });

    it('sets CORS headers on GET, POST, PATCH, and DELETE requests', async () => {
      const server = await createNestGateway();
      for (const verb of ['GET', 'POST', 'PATCH', 'DELETE'] as const) {
        const res = await server.inject({
          method: verb,
          url: '/api/v1/test',
          headers: {
            origin: 'http://localhost:3100',
          },
        });

        const expectedStatus = verb === 'POST' ? 201 : 200;
        expect(res.statusCode).toBe(expectedStatus);
        expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3100');
        expect(res.headers['access-control-allow-credentials']).toBe('true');
        expect(JSON.parse(res.payload)).toEqual({ method: verb });
      }
    });

    it('omits allow-origin header on requests from untrusted origins', async () => {
      const server = await createNestGateway();
      const res = await server.inject({
        method: 'PUT',
        url: '/api/v1/test',
        headers: {
          origin: 'https://malicious.example.com',
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ exploit: true }),
      });

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('supports multiple comma-separated origins from CORS_ORIGINS environment variable', async () => {
      const multiOrigins = 'http://localhost:3100,http://localhost:3000,https://app.ipms.internal';
      const server = await createNestGateway(multiOrigins);

      for (const origin of multiOrigins.split(',')) {
        const preflight = await server.inject({
          method: 'OPTIONS',
          url: '/api/v1/test',
          headers: {
            origin,
            'access-control-request-method': 'PUT',
          },
        });
        expect(preflight.statusCode).toBe(204);
        expect(preflight.headers['access-control-allow-origin']).toBe(origin);

        const putRes = await server.inject({
          method: 'PUT',
          url: '/api/v1/test',
          headers: {
            origin,
            'content-type': 'application/json',
          },
          payload: JSON.stringify({}),
        });
        expect(putRes.statusCode).toBe(200);
        expect(putRes.headers['access-control-allow-origin']).toBe(origin);
      }
    });
  });
});
