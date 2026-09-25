import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { PrismaClient } from '@prisma-clients/qc';
import { uuidv7 } from '@ipms/contracts';
import { importProjectWorkOrders } from './import-project-work-orders.js';
import { ACTOR, seedPublishedTemplate } from './fixtures.js';
import { startTestDb } from './test-db.js';

/** project's tables as they stood before work orders moved, reduced to the columns the import reads. */
const PROJECT_BEFORE = `
  CREATE TABLE project (id uuid PRIMARY KEY, code varchar(50) NOT NULL, name varchar(200) NOT NULL);
  CREATE TABLE site (id uuid PRIMARY KEY, "projectId" uuid NOT NULL, "siteCode" varchar(50) NOT NULL, name varchar(200) NOT NULL, city varchar(100), area varchar(100));
  CREATE TABLE task (
    id uuid PRIMARY KEY, "projectId" uuid NOT NULL, "siteId" uuid NOT NULL, "taskTypeId" uuid, "templateId" uuid,
    "workOrderType" varchar(30), "templateName" varchar(250), title varchar(250) NOT NULL, status varchar(30) NOT NULL,
    "assigneeId" uuid, "plannedCompletionAt" timestamptz, "actualCompletionAt" timestamptz, "currentSubmissionId" uuid,
    "currentAttemptNo" integer, "cancelReason" varchar(500), "createdBy" uuid NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now());
  CREATE TABLE work_order_event (id uuid PRIMARY KEY, "taskId" uuid NOT NULL, kind varchar(20) NOT NULL, at timestamptz NOT NULL, "actorId" uuid, detail jsonb NOT NULL DEFAULT '{}');`;

let qc: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let project: StartedPostgreSqlContainer;

beforeAll(async () => {
  qc = await startTestDb();
  prisma = qc.prisma;
  project = await new PostgreSqlContainer('postgres:17-alpine').start();
}, 180_000);
afterAll(async () => { await qc?.stop(); await project?.stop(); });

describe('importing project’s work orders', () => {
  it('copies work orders and their timelines with their ids, once, and ignores planned tasks', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    const [projectId, siteId, orderId, plannedId, eventId] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
    const source = new pg.Client({ connectionString: project.getConnectionUri() });
    await source.connect();
    await source.query(PROJECT_BEFORE);
    await source.query(`INSERT INTO project VALUES ($1, 'TI-L2100', 'Antenna upgrade')`, [projectId]);
    await source.query(`INSERT INTO site VALUES ($1, $2, 'KOS102X', 'SAKUWA GACHHI', 'Biratnagar', NULL)`, [siteId, projectId]);
    await source.query(
      `INSERT INTO task (id, "projectId", "siteId", "templateId", "workOrderType", "templateName", title, status, "assigneeId", "plannedCompletionAt", "createdBy")
       VALUES ($1, $2, $3, $4, 'QUALITY_SELF_CHECK', 'Antenna + RRU', '[Quality Self-check]SAKUWA GACHHI', 'REVIEWING', $5, '2026-09-30T18:14:59Z', $5)`,
      [orderId, projectId, siteId, templateId, ACTOR],
    );
    await source.query(
      `INSERT INTO task (id, "projectId", "siteId", "taskTypeId", title, status, "createdBy") VALUES ($1, $2, $3, $4, 'Planned', 'NOT_STARTED', $5)`,
      [plannedId, projectId, siteId, uuidv7(), ACTOR],
    );
    await source.query(`INSERT INTO work_order_event VALUES ($1, $2, 'CREATED', now(), $3, '{"templateVersion":1}')`, [eventId, orderId, ACTOR]);
    await source.end();

    const url = qc.connectionString;
    await expect(importProjectWorkOrders(project.getConnectionUri(), url)).resolves.toEqual({ workOrders: 1, events: 1 });
    await expect(importProjectWorkOrders(project.getConnectionUri(), url)).resolves.toEqual({ workOrders: 0, events: 0 });

    const copied = await prisma.workOrder.findUniqueOrThrow({ where: { id: orderId }, include: { events: true } });
    expect(copied).toMatchObject({
      projectCode: 'TI-L2100', siteCode: 'KOS102X', siteName: 'SAKUWA GACHHI', siteCity: 'Biratnagar',
      status: 'REVIEWING', templateId, assigneeId: ACTOR,
    });
    expect(copied.events).toEqual([expect.objectContaining({ id: eventId, kind: 'CREATED', detail: { templateVersion: 1 } })]);
    expect(await prisma.workOrder.count()).toBe(1);
  });

  it('has nothing to copy once project no longer has work order columns', async () => {
    const empty = await new PostgreSqlContainer('postgres:17-alpine').start();
    try {
      const client = new pg.Client({ connectionString: empty.getConnectionUri() });
      await client.connect();
      await client.query(`CREATE TABLE task (id uuid PRIMARY KEY)`);
      await client.end();
      await expect(importProjectWorkOrders(empty.getConnectionUri(), qc.connectionString)).resolves.toEqual({ workOrders: 0, events: 0 });
    } finally {
      await empty.stop();
    }
  }, 120_000);
});

