import { describe, expect, it, vi } from 'vitest';
import { STREAMS } from '@ipms/events';
import { ensureProjectionReplay, WATERMARK } from './replay.js';
import { SCOPE_DURABLE } from './scope.consumer.js';

function build(opts: { watermark?: unknown; empty?: boolean; deleteError?: unknown } = {}) {
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
  return { bus, prisma, repo, del, upsert };
}

describe('ensureProjectionReplay', () => {
  it('recreates the durable when the projection is empty and unstamped', async () => {
    // The dangerous case: the database was rebuilt under a durable that has
    // already acked everything, so nothing would ever be redelivered and every
    // non-global user is denied forever while looking correctly fail-closed.
    const { bus, prisma, repo, del } = build();
    expect(await ensureProjectionReplay(bus as never, prisma as never, repo as never)).toBe(true);
    expect(del).toHaveBeenCalledWith(STREAMS.IAM.name, SCOPE_DURABLE);
  });

  it('stamps the watermark after recreating, so the next boot leaves it alone', async () => {
    const { bus, prisma, repo, upsert } = build();
    await ensureProjectionReplay(bus as never, prisma as never, repo as never);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { name: WATERMARK } }));
  });

  it('does nothing when the watermark is already present', async () => {
    // Recreating a healthy durable would replay the whole retention window on
    // every ordinary restart, for no benefit.
    const { bus, prisma, repo, del } = build({ watermark: { name: WATERMARK } });
    expect(await ensureProjectionReplay(bus as never, prisma as never, repo as never)).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });

  it('does nothing when a user genuinely has no scope', async () => {
    // Empty table but stamped: every grant really was revoked. This is the
    // case the watermark exists to tell apart from a lost projection.
    const { bus, prisma, repo, del } = build({ watermark: { name: WATERMARK }, empty: true });
    expect(await ensureProjectionReplay(bus as never, prisma as never, repo as never)).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });

  it('stamps without replaying when rows exist but the watermark does not', async () => {
    // A boot killed between replicating and stamping. Replaying would be
    // pointless work to reach the state we are already in.
    const { bus, prisma, repo, del, upsert } = build({ empty: false });
    expect(await ensureProjectionReplay(bus as never, prisma as never, repo as never)).toBe(false);
    expect(del).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalled();
  });

  it('treats a missing durable as the ordinary first boot', async () => {
    const { bus, prisma, repo } = build({ deleteError: new Error('consumer not found') });
    await expect(ensureProjectionReplay(bus as never, prisma as never, repo as never)).resolves.toBe(true);
  });

  it('propagates a real broker fault instead of mistaking it for a missing durable', async () => {
    // Swallowing this would stamp the watermark and skip the replay forever,
    // leaving the projection permanently empty.
    const { bus, prisma, repo, upsert } = build({ deleteError: new Error('connection refused') });
    await expect(ensureProjectionReplay(bus as never, prisma as never, repo as never))
      .rejects.toThrow(/connection refused/);
    expect(upsert).not.toHaveBeenCalled();
  });
});
