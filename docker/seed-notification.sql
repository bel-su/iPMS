-- ====================================================================
-- iPMS Notification Seed Data (ipms_notification)
-- ====================================================================

BEGIN;

INSERT INTO "notification" ("id", "recipientId", "type", "title", "body", "actionUrl", "isRead", "readAt", "createdAt")
VALUES
  (
    '77777777-1111-1111-1111-111111111111',
    '01a0cdb7-e328-7000-bb83-32768f52d876', -- engineer
    'WORK_ORDER_ASSIGNED',
    'New Work Order Assigned: KTM-5G-001 Civil Structure',
    'You have been assigned to complete the 5G Telecom Tower Civil Structure Quality Checklist at Thamel Central Rooftop Hub.',
    '/quality/work-orders/f1111111-1111-1111-1111-111111111111',
    false, NULL, NOW() - INTERVAL '2 hours'
  ),
  (
    '77777777-2222-2222-2222-222222222222',
    '01a0cdb7-e328-7000-bb83-32768f52d876', -- engineer
    'RECTIFICATION_REQUESTED',
    'Rectification Requested: LAL-5G-014 Earthing Audit',
    'QC Manager rejected attempt #1: Earth resistance measured 7.8 Ohms (exceeds 5 Ohm specification). Please improve grounding pit bentonite mix and resubmit.',
    '/quality/work-orders/f2222222-2222-2222-2222-222222222222',
    false, NULL, NOW() - INTERVAL '18 hours'
  ),
  (
    '77777777-3333-3333-3333-333333333333',
    '01a0cdb7-e306-7000-8886-6ca6c8edb78c', -- manager
    'SUBMISSION_RECEIVED',
    'New QC Submission Awaiting Review: KTM-5G-001',
    'Field Engineer submitted Attempt #1 for Thamel Central Rooftop Hub with 4 verified geotagged photos.',
    '/quality/work-orders/f1111111-1111-1111-1111-111111111111',
    false, NULL, NOW() - INTERVAL '4 hours'
  ),
  (
    '77777777-4444-4444-4444-444444444444',
    '01a0cdb7-e306-7000-8886-6ca6c8edb78c', -- manager
    'MILESTONE_READY',
    'Milestone Completed: M1-CIVIL on Baluwatar Core Hub',
    'All requirements for Structural Civil Ready have been satisfied on KTM-5G-009.',
    '/projects/a1111111-1111-1111-1111-111111111111',
    true, NOW() - INTERVAL '1 day', NOW() - INTERVAL '2 days'
  ),
  (
    '77777777-5555-5555-5555-555555555555',
    '01a0cdb7-e2e2-7000-80c3-4d088c0aaf33', -- admin
    'SYSTEM_ALERT',
    'Platform Security & Scope Check Active',
    'Zero-trust token rotation and outbox event replication operational across 7 microservice domains.',
    '/',
    false, NULL, NOW() - INTERVAL '1 hour'
  )
ON CONFLICT ("id") DO NOTHING;

COMMIT;
