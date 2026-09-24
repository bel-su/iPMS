import {
  SUBJECTS, type DurableConsumer,
  type IamScopeGranted, type IamScopeRevoked, type IamUserDeactivated,
} from '@ipms/events';
import { createLogger } from '@ipms/observability';
import type { UserScopeRepository } from './user-scope.repository.js';

const log = createLogger('project');

/**
 * One durable per subject, matching STREAMS.IAM.durableConsumers.
 *
 * A JetStream durable carries a single `filter_subject`. Registering one durable
 * for several subjects does not widen it: `consumers.add` returns "consumer
 * already exists" for every call after the first, `DurableConsumer.subscribe`
 * swallows that, and the extra subjects are never delivered. That produced a
 * projection where grants replicated and revocations did not -- access was
 * never withdrawn, which fails open.
 *
 * Keyed by subject so the mapping cannot drift from the subscriptions below.
 */
export const SCOPE_DURABLES: Readonly<Record<string, string>> = {
  [SUBJECTS.IAM_SCOPE_GRANTED]: 'project-scope-granted',
  [SUBJECTS.IAM_SCOPE_REVOKED]: 'project-scope-revoked',
  [SUBJECTS.IAM_USER_DEACTIVATED]: 'project-scope-deactivated',
};

/** Namespace for this consumer's dedupe keys. Shared with the replay, which clears them. */
export const SCOPE_DEDUPE_PREFIX = 'project-scope';

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
    await consumer.subscribe<IamScopeGranted>(SUBJECTS.IAM_SCOPE_GRANTED, SCOPE_DURABLES[SUBJECTS.IAM_SCOPE_GRANTED]!, async (envelope) => {
      await this.repo.applyGranted(envelope.payload);
      log.debug(
        { eventId: envelope.eventId, userId: envelope.payload.userId, level: envelope.payload.level },
        'scope granted',
      );
    });

    await consumer.subscribe<IamScopeRevoked>(SUBJECTS.IAM_SCOPE_REVOKED, SCOPE_DURABLES[SUBJECTS.IAM_SCOPE_REVOKED]!, async (envelope) => {
      await this.repo.applyRevoked(envelope.payload);
      log.debug(
        { eventId: envelope.eventId, userId: envelope.payload.userId, level: envelope.payload.level },
        'scope revoked',
      );
    });

    await consumer.subscribe<IamUserDeactivated>(SUBJECTS.IAM_USER_DEACTIVATED, SCOPE_DURABLES[SUBJECTS.IAM_USER_DEACTIVATED]!, async (envelope) => {
      await this.repo.clearUser(envelope.payload.userId);
      log.info({ eventId: envelope.eventId, userId: envelope.payload.userId }, 'scope cleared for deactivated user');
    });
  }
}
