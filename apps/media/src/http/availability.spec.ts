import { S3ServiceException } from '@aws-sdk/client-s3';
import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma-clients/media';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { isServiceUnavailable } from './availability.js';

function s3(name: string, httpStatusCode: number): S3ServiceException {
  return new S3ServiceException({
    name, $fault: 'server', $metadata: { httpStatusCode }, message: name,
  });
}

describe('isServiceUnavailable', () => {
  it('is true for a 5xx S3/R2 SDK error', () => {
    expect(isServiceUnavailable(s3('InternalError', 500))).toBe(true);
    expect(isServiceUnavailable(s3('ServiceUnavailable', 503))).toBe(true);
  });

  it('is false for a 4xx S3/R2 SDK error — that is a request problem, not an outage', () => {
    expect(isServiceUnavailable(s3('NoSuchKey', 404))).toBe(false);
    expect(isServiceUnavailable(s3('AccessDenied', 403))).toBe(false);
  });

  it('is true for a Prisma connection-initialization failure', () => {
    const err = new Prisma.PrismaClientInitializationError('Can\'t reach database server', '7.x');
    expect(isServiceUnavailable(err)).toBe(true);
  });

  it('is true for known Prisma connection error codes P1001/P1002/P1008/P1017', () => {
    for (const code of ['P1001', 'P1002', 'P1008', 'P1017']) {
      const err = new Prisma.PrismaClientKnownRequestError('connection failed', { code, clientVersion: '7.x' });
      expect(isServiceUnavailable(err)).toBe(true);
    }
  });

  it('is false for an unrelated Prisma known-request error, e.g. a unique-constraint violation', () => {
    const err = new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.x' });
    expect(isServiceUnavailable(err)).toBe(false);
  });

  it('is true for a raw network/connection error such as ECONNREFUSED', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9000'), { code: 'ECONNREFUSED' });
    expect(isServiceUnavailable(err)).toBe(true);
  });

  it('is true for a timeout error wrapped in a Node fetch/undici AggregateError', () => {
    const inner = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    expect(isServiceUnavailable(new AggregateError([inner], 'fetch failed'))).toBe(true);
  });

  it('is true for a network error nested under an Error.cause', () => {
    const inner = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(isServiceUnavailable(new Error('wrapped', { cause: inner }))).toBe(true);
  });

  it('is false for an HttpException, a ZodError, or a plain bug', () => {
    expect(isServiceUnavailable(new HttpException('nope', 409))).toBe(false);
    expect(isServiceUnavailable(new ZodError([]))).toBe(false);
    expect(isServiceUnavailable(new TypeError('cannot read property of undefined'))).toBe(false);
    expect(isServiceUnavailable(undefined)).toBe(false);
  });
});
