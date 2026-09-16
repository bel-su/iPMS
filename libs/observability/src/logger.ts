import pino, { type Logger, type DestinationStream } from 'pino';
import { getCorrelationId } from './correlation.js';

const REDACTED = ['password', 'token', 'accessToken', 'refreshToken', 'secret', 'authorization'];

export function createLogger(service: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level: process.env['LOG_LEVEL'] ?? 'info',
      base: { service },
      redact: { paths: REDACTED, censor: '[Redacted]' },
      mixin() {
        const correlationId = getCorrelationId();
        return correlationId ? { correlationId } : {};
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination ?? pino.destination(1),
  );
}

export type { Logger };
