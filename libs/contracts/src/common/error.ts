import { z } from 'zod';

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
    correlationId: z.string().min(1),
  }),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export function buildError(
  code: ErrorCode,
  message: string,
  correlationId: string,
  details?: Record<string, unknown>,
): ErrorEnvelope {
  return { error: { code, message, correlationId, ...(details ? { details } : {}) } };
}
