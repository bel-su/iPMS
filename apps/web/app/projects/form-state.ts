/**
 * What a form shows between submissions — and nothing else.
 *
 * Deliberately free of imports. Both sides of the boundary need these: the
 * client components render a `FormState` and seed `useActionState` with
 * `EMPTY`, while the server actions return one. Putting `revalidatePath` in
 * this module would pull it into the browser bundle through those client
 * components, which Next refuses to build. The server-side half lives in
 * `settle.ts`.
 */

export interface FormState {
  error?: string;
  correlationId?: string;
}

export const EMPTY: FormState = {};
