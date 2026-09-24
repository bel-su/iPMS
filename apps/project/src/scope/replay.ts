import { STREAMS, type EventBus } from '@ipms/events';
import { createLogger } from '@ipms/observability';
import type { PrismaClient } from '@prisma-clients/project';
import type { UserScopeRepository } from './user-scope.repository.js';
import { SCOPE_DURABLES } from './scope.consumer.js';

const log = createLogger('project');

export const WATERMARK = 'user_scope';

/**
 * Clears this consumer's deduplication namespace.
 *
 * Deleting the durable makes JetStream redeliver from the start, but
 * `DurableConsumer` checks the dedupe store before dispatching and the store
 * outlives the process -- Redis is a separate container with a 24h TTL. So
 * without this, every replayed event is dropped as a duplicate and a rebuilt
 * projection is never actually rebuilt: the replay reports success and changes
 * nothing.
 *
 * The distinction the dedupe store cannot make on its own is between "this
 * message arrived twice" and "we deliberately asked for all of it again". Only
 * the caller knows which, so the caller clears it.
 */
export interface DedupeReset {
  clear(): Promise<void>;
}

/**
 * Rebuilds the scope projection when it has been lost.
 *
 * `DurableConsumer` creates its durable with `DeliverPolicy.All`, so a *new*
 * durable replays the stream from the beginning. An *existing* durable resumes
 * from its stored position -- which is exactly wrong when the projection
 * database has been rebuilt underneath it: every grant it already acked is gone
 * from the table and will never be redelivered. An empty table plus a live
 * durable means every non-global user is denied forever, silently, and the
 * denial looks like correct fail-closed behaviour.
 *
 * The watermark is what makes the two cases distinguishable. An empty table
 * WITH a watermark means every grant was genuinely revoked -- leave it alone.
 * An empty table WITHOUT one means nothing has ever been replicated, or the
 * database was rebuilt -- delete the durable so the next subscribe recreates it
 * and replays.
 *
 * Bounded by the IAM stream's retention. Beyond that a replay recovers only
 * what the stream still holds, and the documented recovery is an iam-side
 * re-emit. Denying in the meantime is the safe direction.
 *
 * Returns true when it recreated the durable.
 */
export async function ensureProjectionReplay(
  bus: EventBus,
  prisma: PrismaClient,
  repo: UserScopeRepository,
  dedupe: DedupeReset,
): Promise<boolean> {
  const watermark = await prisma.projectionWatermark.findUnique({ where: { name: WATERMARK } });
  if (watermark !== null) return false;

  if (!await repo.isEmpty()) {
    // Rows but no watermark: a previous boot replicated successfully and was
    // killed before stamping. Stamp it and carry on rather than replaying a
    // week of events to reach the state we are already in.
    await stamp(prisma);
    return false;
  }

  const durables = [...new Set(Object.values(SCOPE_DURABLES))];
  log.warn({ durables }, 'scope projection is empty and unstamped; recreating the durables to replay');

  for (const durable of durables) {
    try {
      await bus.manager().consumers.delete(STREAMS.IAM.name, durable);
    } catch (err) {
      // Not-found is the ordinary first-boot case: there is no durable to
      // delete, and the subscribe that follows creates one that replays anyway.
      // Anything else is a real broker fault and must not be mistaken for it.
      if (!/not found|does not exist/i.test(String(err))) throw err;
    }
  }

  // Before stamping, not after: if this throws, the watermark stays absent and
  // the next boot retries the whole replay. Stamping first would record a
  // rebuild that never happened.
  await dedupe.clear();

  await stamp(prisma);
  return true;
}

async function stamp(prisma: PrismaClient): Promise<void> {
  await prisma.projectionWatermark.upsert({
    where: { name: WATERMARK }, update: {}, create: { name: WATERMARK },
  });
}
