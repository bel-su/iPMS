/**
 * One-off: copies the work orders project used to hold into qc's own tables.
 *
 * Runs in qc's migrate container after `prisma migrate deploy`, and before
 * project's migration that drops them — Compose orders `project-migrate` after
 * `qc-migrate` for exactly this. Ids are kept, so every submission already
 * recorded against a task id still belongs to the same work order.
 *
 * Idempotent: a row already copied is skipped, and a project database that no
 * longer has (or never had) work order columns has nothing to copy. It fails
 * loudly rather than skipping a row it cannot copy, since the step after it
 * deletes the source.
 *
 *   PROJECT_DATABASE_URL=… DATABASE_URL=… node --import @swc-node/register/esm-register prisma/import-project-work-orders.ts
 */
import pg from 'pg';

const WORK_ORDERS = `
  SELECT t.id, t."projectId", p.code AS "projectCode", p.name AS "projectName",
         t."siteId", s."siteCode", s.name AS "siteName", s.city AS "siteCity", s.area AS "siteArea",
         t."templateId", t."templateName", t."workOrderType", t.title, t.status, t."assigneeId",
         t."plannedCompletionAt", t."actualCompletionAt", t."currentSubmissionId", t."currentAttemptNo",
         t."cancelReason", t."createdBy", t."createdAt"
    FROM task t JOIN project p ON p.id = t."projectId" JOIN site s ON s.id = t."siteId"
   WHERE t."workOrderType" IS NOT NULL`;

async function hasWorkOrders(project: pg.Client): Promise<boolean> {
  const found = await project.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'task' AND column_name = 'workOrderType'`,
  );
  return found.rowCount === 1;
}

export async function importProjectWorkOrders(projectUrl: string, qcUrl: string): Promise<{ workOrders: number; events: number }> {
  const project = new pg.Client({ connectionString: projectUrl });
  const qc = new pg.Client({ connectionString: qcUrl });
  await project.connect();
  await qc.connect();
  try {
    if (!await hasWorkOrders(project)) return { workOrders: 0, events: 0 };
    const orders = (await project.query(WORK_ORDERS)).rows;
    const events = orders.length === 0 ? [] : (await project.query(
      `SELECT id, "taskId", kind, at, "actorId", detail FROM work_order_event WHERE "taskId" = ANY($1::uuid[])`,
      [orders.map((order) => order.id)],
    )).rows;

    let copied = 0;
    let copiedEvents = 0;
    await qc.query('BEGIN');
    try {
      for (const o of orders) {
        if (!o.templateId || !o.assigneeId || !o.plannedCompletionAt) {
          throw new Error(`Work order ${o.id} has no template, assignee or due date; fix it in project before importing`);
        }
        const result = await qc.query(
          `INSERT INTO work_order (id, "projectId", "projectCode", "projectName", "siteId", "siteCode", "siteName", "siteCity", "siteArea",
             "templateId", "templateName", "workOrderType", title, status, "assigneeId", "plannedCompletionAt", "actualCompletionAt",
             "currentSubmissionId", "currentAttemptNo", "cancelReason", "createdBy", "createdAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
           ON CONFLICT (id) DO NOTHING`,
          [o.id, o.projectId, o.projectCode, o.projectName, o.siteId, o.siteCode, o.siteName, o.siteCity, o.siteArea,
            o.templateId, o.templateName ?? '', o.workOrderType, o.title, o.status, o.assigneeId, o.plannedCompletionAt, o.actualCompletionAt,
            o.currentSubmissionId, o.currentAttemptNo, o.cancelReason, o.createdBy, o.createdAt],
        );
        copied += result.rowCount ?? 0;
      }
      for (const e of events) {
        const result = await qc.query(
          `INSERT INTO work_order_event (id, "workOrderId", kind, at, "actorId", detail) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
          [e.id, e.taskId, e.kind, e.at, e.actorId, JSON.stringify(e.detail)],
        );
        copiedEvents += result.rowCount ?? 0;
      }
      await qc.query('COMMIT');
    } catch (err) {
      await qc.query('ROLLBACK');
      throw err;
    }
    return { workOrders: copied, events: copiedEvents };
  } finally {
    await project.end();
    await qc.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const projectUrl = process.env['PROJECT_DATABASE_URL'];
  const qcUrl = process.env['DATABASE_URL'];
  if (!projectUrl || !qcUrl) {
    console.error('PROJECT_DATABASE_URL and DATABASE_URL must both be set');
    process.exit(1);
  }
  importProjectWorkOrders(projectUrl, qcUrl)
    .then((copied) => { console.log(`imported ${copied.workOrders} work orders and ${copied.events} timeline events from project`); })
    .catch((err: unknown) => { console.error('work order import failed:', err); process.exit(1); });
}
