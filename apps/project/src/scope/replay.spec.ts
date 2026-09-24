import { describe, expect, it, vi } from 'vitest';
import { STREAMS } from '@ipms/events';
import { ensureProjectionReplay, WATERMARK } from './replay.js';
import { SCOPE_DURABLES } from './scope.consumer.js';

function build(opts: { watermark?: unknown; empty?: boolean; deleteError?: unknown; clearError?: unknown } = {}) {
  const del = opts.deleteError === undefined
    ? vi.fn().mockResolvedValue(true)
    : vi.fn().mockRejectedValue(opts.deleteError);
  const bus = { manager: () => ({ consumers: { delete: del } }) };
  const upsert = vi.fn().mockResolvedValue({});
  const prisma = {
    projectionWatermark: {
      findUnique: vi.fn().mockResolvedValue(opts.watermark ?? null),
      upsert,
    },
  };
  const repo = { isEmpty: vi.fn().mockResolvedValue(opts.empty ?? true) };
  const clear = opts.clearError === undefined
    ? vi.fn().mockResolvedValue(undefined)
    : vi.fn().mockRejectedValue(opts.clearError);
  const dedupe = { clear };
  return { bus, prisma, repo, dedupe, del, upsert, clear };
}

describe('ensureProjectionReplay', () => {
  it('recreates the durable when the projection is empty and unstamped', async () => {
    // The dangerous case: the database was rebuilt under a durable that has
    // already acked everything, so nothing would ever be redelivered and every
    // non-global user is denied forever while looking correctly fail-closed.
    const { bus, prisma, repo, dedupe, del } = build();
    expect(await ensureProjectionReplay(bus as never, prisma as never, repo as never, dedupe as never)).toBe(true);
    for (const durable of new Set(Object.values(SCOPE_DURABLES))) {
      expect(del, durable).toHaveBeenCalledWith(STREAMS.IAM.name, durable);
    }
  });

  it('stamps the watermark after recreating, so the next boot leaves it alone', async () => {
    const { bus, prisma, repo, dedupe, upsert } = build();
    await ensureProjectionReplay(bus as never, prisma as never, repo as never, dedupe as never);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { name: WATERMARK } }));
  });

  it('does nothing when the watermark is already present', async () => {
    // Recreating a healthy durable would replay the whole retention window on
    // every ordinary restart, for no benefit.
    const { bus, prisma, repo, dedupe, del } = build({ watermark: { name: WATERMARK } });
    expect(await ensureProjectionReplay(bus as never, prisma as never, repo as never, dedupe as never)).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });

  it('does nothing when a user genuinely has no scope', async () => {
    // Empty table but stamped: every grant really was revoked. This is the
    // case the watermark exists to tell apart from a lost projection.
    const { bus, prisma, repo, dedupe, del } = build({ watermark: { name: WATERMARK }, empty: true });
    expect(await ensureProjectionReplay(bus as never, prisma as never, repo as never, dedupe as never)).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });

  it('stamps without replaying when rows exist but the watermark does not', async () => {
    // A boot killed between replicating and stamping. Replaying would be
    // pointless work to reach the state we are already in.
    const { bus, prisma, repo, dedupe, del, upsert } = build({ empty: false });
    expect(await ensureProjectionReplay(bus as never, prisma as never, repo as never, dedupe as never)).toBe(false);
    expect(del).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalled();
  });

  it('treats a missing durable as the ordinary first boot', async () => {
    const { bus, prisma, repo, dedupe } = build({ deleteError: new Error('consumer not found') });
    await expect(ensureProjectionReplay(bus as never, prisma as never, repo as never, dedupe as never)).resolves.toBe(true);
  });

  it('propagates a real broker fault instead of mistaking it for a missing durable', async () => {
    // Swallowing this would stamp the watermark and skip the replay forever,
    // leaving the projection permanently empty.
    const { bus, prisma, repo, dedupe, upsert } = build({ deleteError: new Error('connection refused') });
    await expect(ensureProjectionReplay(bus as never, prisma as never, repo as never, dedupe as never))
      .rejects.toThrow(/connection refused/);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('ensureProjectionReplay clears deduplication', () => {
  it('clears the dedupe namespace when it replays', async () => {
    // Deleting the durable makes JetStream redeliver, but DurableConsumer checks
    // the dedupe store first and that store outlives the process. Without this,
    // every replayed event is dropped as a duplicate: the replay reports success
    // and rebuilds nothing.
    const { bus, prisma, repo, dedupe, clear } = build();
    await ensureProjectionReplay(bus as never, prisma as never, repo as never, dedupe as never);
    expect(clear).toHaveBeenCalledOnce();
  });

  it('does not clear when there is nothing to replay', async () => {
    const { bus, prisma, repo, dedupe, clear } = build({ watermark: { name: WATERMARK } });
    await ensureProjectionReplay(bus as never, prisma as never, repo as never, dedupe as never);
    expect(clear).not.toHaveBeenCalled();
  });

  it('leaves the watermark unstamped if the clear fails', async () => {
    // Stamping a rebuild that did not happen would make the next boot skip the
    // replay forever, leaving the projection permanently empty.
    const { bus, prisma, repo, dedupe, upsert } = build({ clearError: new Error('redis down') });
    await expect(ensureProjectionReplay(bus as never, prisma as never, repo as never, dedupe as never))
      .rejects.toThrow(/redis down/);
    expect(upsert).not.toHaveBeenCalled();
  });
});
