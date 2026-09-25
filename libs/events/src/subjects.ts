export const SUBJECTS = {
  IAM_SCOPE_GRANTED: 'iam.scope.granted',
  IAM_SCOPE_REVOKED: 'iam.scope.revoked',
  IAM_ROLE_ASSIGNED: 'iam.role.assigned',
  IAM_ROLE_REMOVED: 'iam.role.removed',
  IAM_USER_DEACTIVATED: 'iam.user.deactivated',
  AUDIT_EVENT: 'audit.event.recorded',
  QC_SUBMISSION_SUBMITTED: 'qc.submission.submitted',
  QC_SUBMISSION_REVIEWED: 'qc.submission.reviewed',
} as const;

export type Subject = (typeof SUBJECTS)[keyof typeof SUBJECTS];

export interface StreamDefinition {
  name: string;
  subjects: string[];
  maxAgeMs: number;
  durableConsumers: string[];
}

export const STREAMS: Record<'IAM' | 'AUDIT' | 'QC', StreamDefinition> = {
  IAM: {
    name: 'IAM',
    subjects: ['iam.>'],
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    /**
     * One durable per subject, not one per consumer.
     *
     * A JetStream durable carries a single `filter_subject`. Creating one
     * durable and subscribing it to several subjects silently keeps only the
     * first filter -- `consumers.add` reports "consumer already exists" for the
     * rest -- so the other subjects are never delivered at all. `project` hit
     * exactly that: revocations and deactivations went nowhere while grants
     * flowed, which fails open.
     */
    durableConsumers: [
      'project-scope-granted', 'project-scope-revoked', 'project-scope-deactivated',
      'qc-scope-cache',
    ],
  },
  AUDIT: {
    name: 'AUDIT',
    subjects: ['audit.event.recorded'],
    maxAgeMs: 30 * 24 * 60 * 60 * 1000,
    // Exactly one consumer. The hash chain requires a single serialized writer.
    durableConsumers: ['audit-ledger-writer'],
  },
  QC: {
    name: 'QC',
    subjects: ['qc.>'],
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    // project moves a work order's status from these; one durable per subject, as for IAM.
    durableConsumers: ['project-task-submitted', 'project-task-reviewed'],
  },
};
