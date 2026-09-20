'use server';
import { redirect } from 'next/navigation';
import { createProject } from '../lib/project-api';
import { type FormState } from './form-state';
import { optional, settle } from './settle';

/**
 * One Server Action per mutation.
 *
 * They run on the server, so they reach `authFetch` and its http-only cookie
 * directly and the forms they back work without client JavaScript. Required
 * fields are checked here before the call: the service would refuse them too,
 * but a round trip to be told "name is required" is a worse answer than an
 * immediate one.
 */
export async function createProjectAction(_previous: FormState, form: FormData): Promise<FormState> {
  const code = optional(form, 'code');
  const name = optional(form, 'name');
  if (!code || !name) return { error: 'A code and a name are required.' };

  const clientName = optional(form, 'clientName');
  const phase = optional(form, 'phase');
  const startDate = optional(form, 'startDate');
  const targetDate = optional(form, 'targetDate');

  const result = await createProject({
    code,
    name,
    ...(clientName === undefined ? {} : { clientName }),
    ...(phase === undefined ? {} : { phase }),
    ...(startDate === undefined ? {} : { startDate: new Date(startDate) }),
    ...(targetDate === undefined ? {} : { targetDate: new Date(targetDate) }),
  });

  const state = await settle(result, '/projects');
  if (state.error) return state;
  if (result.state === 'ready') redirect(`/projects/${result.data.id}`);
  return state;
}
