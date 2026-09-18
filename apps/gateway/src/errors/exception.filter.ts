import { ArgumentsHost, Catch, HttpException, HttpStatus, type ExceptionFilter } from '@nestjs/common';
import { ZodError } from 'zod';
import { buildError, uuidv7, type ErrorCode } from '@ipms/contracts';
import { createLogger, getCorrelationId } from '@ipms/observability';

const log = createLogger('gateway');

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{
      status(code: number): { send(body: unknown): unknown };
    }>();
    const correlationId = getCorrelationId() ?? uuidv7();

    if (exception instanceof ZodError) {
      const details = Object.fromEntries(
        exception.issues.map((i) => [i.path.join('.') || '_root', i.message]),
      );
      response.status(422).send(buildError('VALIDATION_FAILED', 'Request validation failed', correlationId, details));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).send(
        buildError(STATUS_TO_CODE[status] ?? 'INTERNAL', exception.message, correlationId),
      );
      return;
    }

    // Log the real error server-side; return nothing that could leak internals.
    log.error({ err: exception, correlationId }, 'unhandled exception');
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).send(
      buildError('INTERNAL', 'An unexpected error occurred', correlationId),
    );
  }
}
