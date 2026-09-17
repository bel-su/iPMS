export interface DedupeStore {
  seen(eventId: string): Promise<boolean>;
  remember(eventId: string): Promise<void>;
}

/** Bounded LRU. Used in tests and single-process services. */
export class InMemoryDedupeStore implements DedupeStore {
  private readonly entries = new Set<string>();

  constructor(private readonly maxEntries = 10_000) {}

  async seen(eventId: string): Promise<boolean> {
    return this.entries.has(eventId);
  }

  async remember(eventId: string): Promise<void> {
    this.entries.add(eventId);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.values().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

export interface RedisLike {
  set(key: string, value: string, mode: 'EX', ttl: number, flag: 'NX'): Promise<string | null>;
  exists(key: string): Promise<number>;
}

/** Survives restarts and works across replicas. TTL must exceed the stream's redelivery window. */
export class RedisDedupeStore implements DedupeStore {
  constructor(
    private readonly redis: RedisLike,
    private readonly prefix: string,
    private readonly ttlSeconds = 24 * 60 * 60,
  ) {}

  private key(eventId: string): string {
    return `dedupe:${this.prefix}:${eventId}`;
  }

  async seen(eventId: string): Promise<boolean> {
    return (await this.redis.exists(this.key(eventId))) === 1;
  }

  async remember(eventId: string): Promise<void> {
    await this.redis.set(this.key(eventId), '1', 'EX', this.ttlSeconds, 'NX');
  }
}
