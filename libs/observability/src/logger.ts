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

const SECRET_KEY_SET = new Set(SECRET_KEYS.map((key) => key.toLowerCase()));

const REDACTED = '[Redacted]';
const CIRCULAR = '[Circular]';
const MAX_DEPTH_MARKER = '[MaxDepth]';

// pino's redact.paths engine (@pinojs/redact) only supports a single `*`
// wildcard per path segment, so a list of paths can never be depth-independent
// -- enumerating '', '*.', '*.*.' prefixes only ever catches the depths you
// bothered to enumerate, and leaks anything nested deeper (e.g.
// error.response.data.user.password, which is 4 levels deep). Instead we
// censor by key name via a `formatters.log` hook: pino calls this with the
// fully merged log object right before serialization, and we recursively
// rebuild it, replacing the value of any key (at any depth, case-insensitive)
// that matches SECRET_KEYS with '[Redacted]'. This is depth-independent by
// construction since it is a plain recursive walk, not a path enumeration.
const MAX_DEPTH = 12;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  if (value instanceof Date || value instanceof Error) {
    return false;
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function redactValue(value: unknown, depth: number, onPath: WeakSet<object>): unknown {
  // Primitives and non-plain objects (Date, Error, Buffer, RegExp, class
  // instances, etc.) pass through untouched -- we never stringify or mangle
  // them. Error in particular keeps its message and stack intact.
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (value instanceof Error) {
    return value;
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return value;
  }

  if (onPath.has(value)) {
    return CIRCULAR;
  }

  if (depth >= MAX_DEPTH) {
    return MAX_DEPTH_MARKER;
  }

  if (Array.isArray(value)) {
    onPath.add(value);
    try {
      return value.map((item) => redactValue(item, depth + 1, onPath));
    } finally {
      onPath.delete(value);
    }
  }

  if (isPlainObject(value)) {
    onPath.add(value);
    try {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = SECRET_KEY_SET.has(key.toLowerCase())
          ? REDACTED
          : redactValue(val, depth + 1, onPath);
      }
      return result;
    } finally {
      onPath.delete(value);
    }
  }

  // Any other non-plain object type (Map, Set, RegExp, class instances, ...)
  // is left untouched rather than mangled.
  return value;
}

export function createLogger(service: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level: process.env['LOG_LEVEL'] ?? 'info',
      base: { service },
      formatters: {
        log(object) {
          // `object` here is a fresh object pino builds for this log line
          // (merged fields + base + mixin result); redactValue also never
          // mutates its input, so the caller's original object is untouched.
          return redactValue(object, 0, new WeakSet()) as Record<string, unknown>;
        },
      },
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
