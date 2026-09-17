import { describe, expect, it } from 'vitest';
import { InMemoryDedupeStore } from './dedupe.js';

describe('InMemoryDedupeStore', () => {
  it('reports an unseen event as not seen', async () => {
    expect(await new InMemoryDedupeStore().seen('e1')).toBe(false);
  });

  it('reports a remembered event as seen', async () => {
    const store = new InMemoryDedupeStore();
    await store.remember('e1');
    expect(await store.seen('e1')).toBe(true);
  });

  it('keeps distinct event ids independent', async () => {
    const store = new InMemoryDedupeStore();
    await store.remember('e1');
    expect(await store.seen('e2')).toBe(false);
  });

  it('evicts entries past the retention limit so memory stays bounded', async () => {
    const store = new InMemoryDedupeStore(2);
    await store.remember('e1');
    await store.remember('e2');
    await store.remember('e3');
    expect(await store.seen('e1')).toBe(false);
    expect(await store.seen('e3')).toBe(true);
  });
});
