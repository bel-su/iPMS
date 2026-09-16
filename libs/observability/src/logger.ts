import pino, { type Logger, type DestinationStream } from 'pino';
import { getCorrelationId } from './correlation.js';

const SECRET_KEYS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'authorization',
  'apiKey',
  'refresh_token',
  'access_token',
  'passwordHash',
  'cookie',
];

// Pino only matches redact.paths against the exact depth given, so a bare key
// name only catches root-level fields. Combine each key with depth prefixes to
// also catch it nested inside one or two levels of object (e.g. user.password,
// req.headers.authorization). Adding a new secret key only requires editing
// SECRET_KEYS above.
const DEPTH_PREFIXES = ['', '*.', '*.*.'];
const REDACTED = DEPTH_PREFIXES.flatMap((prefix) => SECRET_KEYS.map((key) => `${prefix}${key}`));

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

export type { Logger, DestinationStream };
