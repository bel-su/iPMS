import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ApiResult } from '../lib/api-client';
import { EMPTY, type FormState } from './form-state';

/**
 * Turns an `ApiResult` into something a form can render.
 *
 * A 409 from a guarded delete arrives as `unavailable` carrying the service's
 * own message — "This project still has 3 task(s)…" — which is exactly what
 * the user needs, so it is shown rather than replaced with a generic failure.
 * An unauthenticated caller is redirected instead: no message on a form can
 * help them.
 *
 * Server-side only: `revalidatePath` cannot run in the browser. The type and
 * the empty value the client components need live in `form-state.ts`.
 */
export async function settle<T>(result: ApiResult<T>, revalidate: string): Promise<FormState> {
  if (result.state === 'unauthenticated') redirect('/login');
  if (result.state === 'forbidden') return { error: result.message };
  if (result.state === 'unavailable') {
    return { error: result.message, ...(result.correlationId === undefined ? {} : { correlationId: result.correlationId }) };
  }
  revalidatePath(revalidate);
  return EMPTY;
}

/** Reads a trimmed string field, or undefined when the input was left empty. */
export function optional(form: FormData, field: string): string | undefined {
  const value = form.get(field);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
