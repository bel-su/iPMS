import {
  type CallHandler, type ExecutionContext, HttpException, Injectable, type NestInterceptor, ServiceUnavailableException,
} from '@nestjs/common';
import { type Observable, catchError, throwError } from 'rxjs';
import { ZodError } from 'zod';
import { isServiceUnavailable } from './availability.js';

/**
 * Media-local: storage and the database are the only two dependencies whose
 * outages this service promises a 503 for (spec §5.3), so this is not shared
 * with libs/observability. Anything already an HttpException (including one
 * a handler built on purpose) or a ZodError is passed through untouched —
 * only a raw S3/Prisma/network error gets remapped.
 */
@Injectable()
export class ServiceUnavailableInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) => {
        if (err instanceof HttpException || err instanceof ZodError) return throwError(() => err);
        if (isServiceUnavailable(err)) {
          return throwError(() => new ServiceUnavailableException('Storage or the database is temporarily unavailable; retry with backoff'));
        }
        return throwError(() => err);
      }),
    );
  }
}
