import { uuidv7 } from '@ipms/contracts';

export interface OutboxRecord {
  id: string;
  subject: string;
  payload: Record<string, unknown>;
  correlationId: string;
  actorId: string | null;
  createdAt: Date;
  publishedAt: Date | null;
}

export function buildOutboxRecord(
  subject: string,
  payload: Record<string, unknown>,
  correlationId: string,
  actorId?: string,
): OutboxRecord {
  return {
    id: uuidv7(),
    subject,
    payload,
    correlationId,
    actorId: actorId ?? null,
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
