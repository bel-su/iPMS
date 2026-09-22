import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ApiResult } from './api-client';
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
 *
 * `revalidate` takes several paths because one value is often rendered on more
 * than one page, and `revalidatePath` only invalidates the exact path it is
 * given — a nested route is not covered by its parent. Refreshing one page and
 * leaving its siblings stale is how a saved change appears not to have saved.
 */
export async function settle<T>(result: ApiResult<T>, revalidate: string | readonly string[]): Promise<FormState> {
  if (result.state === 'unauthenticated') redirect('/login');
  if (result.state === 'forbidden') return { error: result.message };
  if (result.state === 'unavailable') {
    return { error: result.message, ...(result.correlationId === undefined ? {} : { correlationId: result.correlationId }) };
  }
  for (const path of typeof revalidate === 'string' ? [revalidate] : revalidate) revalidatePath(path);
  return EMPTY;
}

/** Reads a trimmed string field, or undefined when the input was left empty. */
export function optional(form: FormData, field: string): string | undefined {
  const value = form.get(field);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Reads a field an update may clear.
 *
 * Three answers where `optional` has two: a field absent from the form means
 * "leave it alone", present but empty means "remove the value", and anything
 * else is the new value. The middle one is what an edit form needs and what a
 * PATCH cannot otherwise be told, so this is not built on `optional`.
 *
 * The key is returned in an object rather than alone so the caller can spread
 * it, and typed through `K` so the spread keeps the field's real name.
 */
export function clearable<K extends string>(form: FormData, field: K): { [P in K]?: string | null } {
  const value = form.get(field);
  if (typeof value !== 'string') return {} as { [P in K]?: string | null };
  const trimmed = value.trim();
  return { [field]: trimmed.length > 0 ? trimmed : null } as { [P in K]?: string | null };
}
