import { Controller, Delete, Get, NotFoundException, Patch, Post, Put, Req, Res } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { getCorrelationId } from '@ipms/observability';
import { normalizeTarget, resolveUpstream } from './routes.js';

/**
 * Headers that describe a single network hop and must not be copied onto the
 * next one. Forwarding `connection` or `transfer-encoding` corrupts the
 * upstream request; forwarding `host` makes the upstream believe it is
 * serving the gateway's virtual host.
 */
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

/**
 * Headers a client must never be able to set, because a service downstream
 * might believe them. The gateway does not vouch for the principal — every
 * service verifies the token itself — but a stray `x-user-id` in a log line
 * or a future trusting change would be a privilege-escalation vector, so
 * they are stripped at the edge regardless.
 */
const CLIENT_FORBIDDEN = new Set(['x-user-id', 'x-user-roles', 'x-user-permissions', 'x-internal']);

@Controller()
export class ProxyController {
  /**
   * Streams the request to its upstream and the response back.
   *
   * Uses `@fastify/reply-from` rather than buffering through `fetch`. The
   * field app uploads geotagged photos, and a buffering proxy would hold every
   * upload in gateway memory and break chunked responses. `reply.from` pipes
   * both directions.
   *
   * The token travels on as-is — in the `Authorization` header or the
   * `ipms_access` cookie — because each service re-verifies it. The gateway
   * adds no trusted header of its own, which is what makes a service safe to
   * reach directly.
   */
  /**
   * One handler per proxied method, all on Fastify's `'*'` wildcard.
   *
   * Deliberately not `@All('*')`: that also registers OPTIONS, which collides
   * with the OPTIONS handler `@fastify/cors` installs on the same route, and
   * the app dies at boot with FST_ERR_DUPLICATED_ROUTE. Preflight belongs to
   * the CORS plugin anyway — it must be answered at the edge, not forwarded to
   * a service that knows nothing about browser origins.
   *
   * The pattern is `'*'` rather than `'*path'` or `':path(.*)'`, both of which
   * Fastify's router rejects or matches only within a single path segment.
   *
   * There is no HEAD handler: Fastify derives HEAD from each GET route by
   * default, and declaring one explicitly kills the app at boot with
   * FST_ERR_DUPLICATED_ROUTE — the same failure mode as OPTIONS above.
   *
   * One handler per method, delegating to `forward`, rather than several decorators
   * stacked on a single handler: Nest stores the method and path in the same
   * metadata keys on the handler, so stacking silently keeps only one of them
   * and every other verb 404s at the edge.
   *
   * All of these were established by booting the service and issuing requests;
   * none is visible to a unit test, because route registration happens at
   * startup.
   */
  @Get('*')
  async proxyGet(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.forward(req, reply);
  }

  @Post('*')
  async proxyPost(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.forward(req, reply);
  }

  @Put('*')
  async proxyPut(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.forward(req, reply);
  }

  @Patch('*')
  async proxyPatch(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.forward(req, reply);
  }

  @Delete('*')
  async proxyDelete(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.forward(req, reply);
  }

  private async forward(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const upstream = resolveUpstream(req.url);
    if (!upstream) {
      // Deliberately the same 404 for "no such route" and "route refused"
      // (traversal, an /internal/ path, bad encoding): the edge should not
      // tell a prober which of its guesses was interesting.
      throw new NotFoundException('Not found');
    }

    // Forward the normalized path, not the raw one. Matching on the normalized
    // form and then forwarding the raw form would let a path that passed the
    // route check arrive upstream as something else entirely.
    const target = normalizeTarget(req.url);
    if (!target) throw new NotFoundException('Not found');

    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value !== 'string' && !Array.isArray(value)) continue;
      const lower = name.toLowerCase();
      if (HOP_BY_HOP.has(lower) || CLIENT_FORBIDDEN.has(lower)) continue;
      headers[lower] = value;
    }

    const correlationId = getCorrelationId();
    if (correlationId) headers['x-correlation-id'] = correlationId;

    await reply.from(`http://${upstream.host}:${upstream.port}${target.path}${target.query}`, {
      rewriteRequestHeaders: () => headers,
    });
  }
}
