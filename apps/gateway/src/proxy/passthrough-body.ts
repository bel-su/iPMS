/** The minimum of Fastify this needs, so the unit test can pass a real instance. */
export interface ContentTypeParserHost {
  addContentTypeParser(
    matcher: string,
    handler: (request: unknown, payload: unknown, done: (err: Error | null, body?: unknown) => void) => void,
  ): void;
}

/**
 * Hands any body Fastify has no parser for straight through, unread.
 *
 * Fastify parses `application/json` and `text/plain` and answers **415** to
 * everything else before a route handler ever runs. That is right for a
 * service that consumes bodies and wrong for a gateway that only forwards
 * them: it made every multipart upload — a site-import workbook, and the field
 * app's photos — fail at the edge with "Unsupported Media Type", while the
 * same request succeeded against the service directly.
 *
 * Registering `'*'` does not displace the JSON parser; it only covers the
 * types that had none. The payload stream is passed along untouched, so
 * `reply.from` still streams it upstream rather than buffering an upload in
 * gateway memory, which is the property the proxy was built for.
 */
export function registerPassthroughBodyParser(fastify: ContentTypeParserHost): void {
  fastify.addContentTypeParser('*', (_request, payload, done) => { done(null, payload); });
}
