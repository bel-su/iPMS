-- CreateTable
CREATE TABLE "audit_event" (
    "id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "eventId" UUID NOT NULL,
    "actorId" VARCHAR(100),
    "action" VARCHAR(100) NOT NULL,
    "objectType" VARCHAR(100) NOT NULL,
    "objectId" VARCHAR(100) NOT NULL,
    "previousState" JSONB NOT NULL DEFAULT '{}',
    "newState" JSONB NOT NULL DEFAULT '{}',
    "details" JSONB NOT NULL DEFAULT '{}',
    "correlationId" VARCHAR(64) NOT NULL,
    "previousHash" CHAR(64) NOT NULL,
    "chainHash" CHAR(64) NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "audit_event_sequence_key" ON "audit_event"("sequence");

-- CreateIndex
CREATE UNIQUE INDEX "audit_event_eventId_key" ON "audit_event"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_event_chainHash_key" ON "audit_event"("chainHash");

-- CreateIndex
CREATE INDEX "audit_event_actorId_timestamp_idx" ON "audit_event"("actorId", "timestamp");

-- CreateIndex
CREATE INDEX "audit_event_objectType_objectId_idx" ON "audit_event"("objectType", "objectId");

-- CreateIndex
CREATE INDEX "audit_event_action_timestamp_idx" ON "audit_event"("action", "timestamp");

-- The ledger is append-only. Revoke UPDATE and DELETE from the service role.
REVOKE UPDATE, DELETE ON audit_event FROM PUBLIC;

CREATE OR REPLACE FUNCTION audit_event_is_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_is_immutable();
CREATE TRIGGER audit_event_no_delete BEFORE DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_is_immutable();
