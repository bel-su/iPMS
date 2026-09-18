import { uuidv7 } from '@ipms/contracts';

/**
 * A payload that survives a JSON round-trip, expressed recursively.
 *
 * Deliberately not `Record<string, unknown>`: Prisma's generated `Json` column
 * input type is `InputJsonObject`, whose values must each be assignable to
 * `InputJsonValue | null`. `unknown` is not, so a `Record<string, unknown>`
 * cannot be handed to `tx.outboxEvent.create({ data })` without a cast at the
 * call site — and that cast would then be copy-pasted into every service that
 * ever writes an outbox row, silently accepting values (a `Date`, a `Map`, a
 * `bigint`) that serialize to something the consumer cannot read. Naming the
 * JSON shape here pushes that check to compile time, once.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface OutboxRecord {
  id: string;
  subject: string;
  payload: JsonObject;
  correlationId: string;
  actorId: string | null;
  createdAt: Date;
  publishedAt: Date | null;
}

export function buildOutboxRecord(
  subject: string,
  payload: JsonObject,
  correlationId: string,
  actorId?: string,
): OutboxRecord {
  return {
    id: uuidv7(),
    subject,
    payload,
    correlationId,
    actorId: actorId ?? null,
    // Set here in JS rather than left to the DB default. This is a pickup gate, not a
    // watermark cursor: the drainer selects WHERE publishedAt IS NULL and orders by
    // createdAt only to pick a scan order among pending rows. Clock skew between
    // replicas can reorder that pickup, but it can never cause an event to be skipped,
    // because the gate is publishedAt IS NULL, not "createdAt > lastSeenCreatedAt".
    // Do not "fix" this into a watermark query on the assumption that createdAt reflects
    // true commit order.
    createdAt: new Date(),
    publishedAt: null,
  };
}

/** Every service embeds this model verbatim in its own prisma/schema.prisma. */
export const OUTBOX_MODEL_SQL = `
model OutboxEvent {
  id            String    @id @db.Uuid
  subject       String    @db.VarChar(100)
  payload       Json
  correlationId String    @db.VarChar(64)
  actorId       String?   @db.Uuid
  createdAt     DateTime  @default(now()) @db.Timestamptz(6)
  publishedAt   DateTime? @db.Timestamptz(6)

  @@index([publishedAt, createdAt])
  @@map("outbox_event")
}
`.trim();
