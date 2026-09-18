import { Injectable, type NestMiddleware } from '@nestjs/common';
import { runWithCorrelation } from '@ipms/observability';
import { uuidv7 } from '@ipms/contracts';

const HEADER = 'x-correlation-id';

/** A caller-supplied id is honoured only in this shape. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(
    req: { headers: Record<string, string | string[] | undefined> },
    res: { setHeader(name: string, value: string): void },
    next: () => void,
  ): void {
    const supplied = req.headers[HEADER];
    const candidate = Array.isArray(supplied) ? supplied[0] : supplied;

    // An inbound correlation id is accepted so a trace can span the mobile
    // client and the platform — but it is validated first. It is written into
    // every log line for the request and forwarded to upstream services, so an
    // unvalidated value lets a caller inject newlines and forge log records,
    // or push an unbounded string through the logging pipeline.
    const correlationId = candidate !== undefined && UUID.test(candidate) ? candidate : uuidv7();

    req.headers[HEADER] = correlationId;
    res.setHeader(HEADER, correlationId);
    runWithCorrelation(correlationId, next);
  }
}
