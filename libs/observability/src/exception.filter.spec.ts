import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ZodError, z } from 'zod';
import { GlobalExceptionFilter } from './exception.filter.js';

function host() {
  const response = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };
  return {
    host: { switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ headers: {} }) }) },
    response,
  };
}

const filter = new GlobalExceptionFilter();

describe('GlobalExceptionFilter', () => {
  it('maps UnauthorizedException to 401 UNAUTHENTICATED', () => {
    const { host: h, response } = host();
    filter.catch(new UnauthorizedException('nope'), h as never);
    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.send.mock.calls[0]![0].error.code).toBe('UNAUTHENTICATED');
  });

  it('maps ForbiddenException to 403 FORBIDDEN', () => {
    const { host: h, response } = host();
    filter.catch(new ForbiddenException('nope'), h as never);
    expect(response.status).toHaveBeenCalledWith(403);
  });

  it('maps NotFoundException to 404', () => {
    const { host: h, response } = host();
    filter.catch(new NotFoundException(), h as never);
    expect(response.status).toHaveBeenCalledWith(404);
  });

  it('maps a ZodError to 422 with field details', () => {
    const { host: h, response } = host();
    const err = z.object({ a: z.string() }).safeParse({}).error as ZodError;
    filter.catch(err, h as never);
    expect(response.status).toHaveBeenCalledWith(422);
    expect(response.send.mock.calls[0]![0].error.code).toBe('VALIDATION_FAILED');
  });

  it('maps an unexpected error to 500 without leaking the message', () => {
    const { host: h, response } = host();
    filter.catch(new Error('connection string postgres://user:secret@host'), h as never);
    expect(response.status).toHaveBeenCalledWith(500);
    const body = response.send.mock.calls[0]![0];
    expect(body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('includes a correlation id on every response', () => {
    const { host: h, response } = host();
    filter.catch(new BadRequestException('bad'), h as never);
    expect(response.send.mock.calls[0]![0].error.correlationId).toBeTruthy();
  });

  it('passes details from an HttpException object response', () => {
    const { host: h, response } = host();
    filter.catch(new ConflictException({ message: 'Some files are not ready', details: { reason: 'MEDIA_NOT_READY', files: [{ id: 'x', reason: 'UPLOADING' }] } }), h as never);
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.send.mock.calls[0]![0].error).toMatchObject({
      code: 'CONFLICT', message: 'Some files are not ready', details: { reason: 'MEDIA_NOT_READY', files: [{ id: 'x', reason: 'UPLOADING' }] },
    });
  });

  it('adds no details for a plain message', () => {
    const { host: h, response } = host();
    filter.catch(new ConflictException('Taken'), h as never);
    expect(response.send.mock.calls[0]![0].error.details).toBeUndefined();
  });

  it.each([['null', null], ['an empty array', []], ['an array', ['x']]])('omits details that are %s', (_label, details) => {
    const { host: h, response } = host();
    filter.catch(new ConflictException({ message: 'Taken', details }), h as never);
    expect(response.send.mock.calls[0]![0].error.details).toBeUndefined();
    expect('details' in response.send.mock.calls[0]![0].error).toBe(false);
  });
});
