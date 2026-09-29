import { S3ServiceException } from '@aws-sdk/client-s3';
import { Prisma } from '@prisma-clients/media';

/**
 * Node/undici connection failures that mean "the peer could not be reached
 * right now", not "the request was wrong". A phone should retry these with
 * backoff, same as a 5xx from storage or a Prisma connection error.
 */
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EPIPE', 'EAI_AGAIN',
]);

/** Prisma connection-layer failures — never a query the caller could fix by retrying differently. */
const TRANSIENT_PRISMA_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017']);

function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code?: unknown }).code === 'string'
    ? (err as { code: string }).code
    : undefined;
}

/**
 * True for exactly the errors §5.3 promises 503 for: storage unavailable
 * (a 5xx from the S3/R2 SDK, or the request never reaching it) and database
 * unavailable (Prisma failing to connect). Anything else — an HttpException
 * a handler threw on purpose, a ZodError, a bug — is left alone so it keeps
 * whatever status it already carries, or falls through to the shared 500.
 */
export function isServiceUnavailable(err: unknown): boolean {
  if (err instanceof S3ServiceException) {
    const status = err.$metadata?.httpStatusCode;
    return status !== undefined && status >= 500;
  }
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) return TRANSIENT_PRISMA_CODES.has(err.code);
  const code = errorCode(err);
  if (code && NETWORK_ERROR_CODES.has(code)) return true;
  if (err instanceof AggregateError) return err.errors.some((inner) => isServiceUnavailable(inner));
  if (err instanceof Error && err.cause !== undefined && err.cause !== err) return isServiceUnavailable(err.cause);
  return false;
}
