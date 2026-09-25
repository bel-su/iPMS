-- The transactional outbox. project was the only service that mutated state
-- without writing to the audit ledger, so every project, site, task type,
-- milestone and task change was invisible to it.
CREATE TABLE "outbox_event" (
  "id" uuid PRIMARY KEY,
  "subject" varchar(100) NOT NULL,
  "payload" jsonb NOT NULL,
  "correlationId" varchar(64) NOT NULL,
  "actorId" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "publishedAt" timestamptz
);
CREATE INDEX "outbox_event_publishedAt_createdAt_idx" ON "outbox_event"("publishedAt","createdAt");
