import {
  SUBJECTS, type DurableConsumer,
  type IamScopeGranted, type IamScopeRevoked, type IamUserDeactivated,
} from '@ipms/events';
import { createLogger } from '@ipms/observability';
import type { UserScopeRepository } from './user-scope.repository.js';

const log = createLogger('project');

/** Already declared in STREAMS.IAM.durableConsumers; this is its implementation. */
export const SCOPE_DURABLE = 'project-scope-cache';

/**
 * Keeps `user_scope` in step with iam.
 *
 * Subscribes to the two scope subjects and to deactivation, and to nothing
 * else. `iam.role.assigned` / `.removed` are deliberately NOT consumed, even
 * though STREAMS.IAM carries them: iam's own `EffectiveService.toScope()`
 * derives scope from the scope tables alone, so a scoped role assignment
 * contributes no reach there. Projecting it here would grant access iam does
 * not recognise and leave the two disagreeing about the same user. A role
 * change alters the *permission* set, which travels in the JWT and is handled
 * by token re-issue.
 */
export class ScopeConsumer {
  constructor(private readonly repo: UserScopeRepository) {}

  async register(consumer: DurableConsumer): Promise<void> {
    await consumer.subscribe<IamScopeGranted>(SUBJECTS.IAM_SCOPE_GRANTED, SCOPE_DURABLE, async (envelope) => {
      await this.repo.applyGranted(envelope.payload);
      log.debug(
        { eventId: envelope.eventId, userId: envelope.payload.userId, level: envelope.payload.level },
        'scope granted',
      );
    });

    await consumer.subscribe<IamScopeRevoked>(SUBJECTS.IAM_SCOPE_REVOKED, SCOPE_DURABLE, async (envelope) => {
      await this.repo.applyRevoked(envelope.payload);
      log.debug(
        { eventId: envelope.eventId, userId: envelope.payload.userId, level: envelope.payload.level },
        'scope revoked',
      );
    });

    await consumer.subscribe<IamUserDeactivated>(SUBJECTS.IAM_USER_DEACTIVATED, SCOPE_DURABLE, async (envelope) => {
      await this.repo.clearUser(envelope.payload.userId);
      log.info({ eventId: envelope.eventId, userId: envelope.payload.userId }, 'scope cleared for deactivated user');
    });
  }
}
