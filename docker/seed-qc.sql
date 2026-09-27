-- ====================================================================
-- iPMS Comprehensive Seed Data for Quality Control Database (ipms_qc)
-- Compatible with TemplateVersion, WorkOrder, and Submissions
-- ====================================================================

BEGIN;

-- 1. CHECKLIST TEMPLATES
INSERT INTO "checklist_template" ("id", "code", "name", "category", "currentVersionId", "disabledAt", "createdBy", "createdAt", "updatedAt")
VALUES
  ('11111111-1111-1111-1111-111111111111', 'QC-CIVIL-5G', '5G Telecom Tower Civil Structure Quality Checklist', 'QUALITY', NULL, NULL, '01a0cdb7-e318-7000-bb1d-b47c5143000e', NOW(), NOW()),
  ('22222222-2222-2222-2222-222222222222', 'QC-ELEC-5G', 'Electrical Earthing, Surge & Lightning Protection Checklist', 'QUALITY', NULL, NULL, '01a0cdb7-e318-7000-bb1d-b47c5143000e', NOW(), NOW()),
  ('33333333-3333-3333-3333-333333333333', 'EHS-TOWER-SAFETY', 'Tower Climbing & Rigging Personal Safety Audit', 'EHS', NULL, NULL, '01a0cdb7-e318-7000-bb1d-b47c5143000e', NOW(), NOW())
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "category" = EXCLUDED."category",
  "updatedAt" = NOW();

-- 2. TEMPLATE VERSIONS (Version 1, PUBLISHED)
INSERT INTO "template_version" ("id", "templateId", "version", "status", "revision", "source", "createdBy", "createdAt", "updatedAt", "publishedAt", "publishedBy", "retiredAt")
VALUES
  ('11111111-0001-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1, 'PUBLISHED', 1, 'WEB', '01a0cdb7-e318-7000-bb1d-b47c5143000e', NOW(), NOW(), NOW(), '01a0cdb7-e318-7000-bb1d-b47c5143000e', NULL),
  ('22222222-0001-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 1, 'PUBLISHED', 1, 'WEB', '01a0cdb7-e318-7000-bb1d-b47c5143000e', NOW(), NOW(), NOW(), '01a0cdb7-e318-7000-bb1d-b47c5143000e', NULL),
  ('33333333-0001-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 1, 'PUBLISHED', 1, 'WEB', '01a0cdb7-e318-7000-bb1d-b47c5143000e', NOW(), NOW(), NOW(), '01a0cdb7-e318-7000-bb1d-b47c5143000e', NULL)
ON CONFLICT ("templateId", "version") DO UPDATE SET
  "status" = EXCLUDED."status",
  "updatedAt" = NOW();

-- Link currentVersionId
UPDATE "checklist_template" SET "currentVersionId" = '11111111-0001-0000-0000-000000000001' WHERE "id" = '11111111-1111-1111-1111-111111111111';
UPDATE "checklist_template" SET "currentVersionId" = '22222222-0001-0000-0000-000000000001' WHERE "id" = '22222222-2222-2222-2222-222222222222';
UPDATE "checklist_template" SET "currentVersionId" = '33333333-0001-0000-0000-000000000001' WHERE "id" = '33333333-3333-3333-3333-333333333333';

-- 3. CHECKLIST SECTIONS
INSERT INTO "checklist_section" ("id", "versionId", "number", "title", "order")
VALUES
  -- Sections for QC-CIVIL-5G
  ('11111111-aaaa-0000-0000-000000000001', '11111111-0001-0000-0000-000000000001', '1.0', 'Base Plate & Anchor Bolt Assembly', 1),
  ('11111111-aaaa-0000-0000-000000000002', '11111111-0001-0000-0000-000000000001', '2.0', 'Mast Verticality & Torque Inspection', 2),
  -- Sections for QC-ELEC-5G
  ('22222222-aaaa-0000-0000-000000000001', '22222222-0001-0000-0000-000000000001', '1.0', 'Earth Pit & Grounding Resistance', 1),
  ('22222222-aaaa-0000-0000-000000000002', '22222222-0001-0000-0000-000000000001', '2.0', 'Surge Protective Devices (SPD)', 2),
  -- Sections for EHS-TOWER-SAFETY
  ('33333333-aaaa-0000-0000-000000000001', '33333333-0001-0000-0000-000000000001', '1.0', 'Personal Protective Equipment & Rigging Gear', 1)
ON CONFLICT ("versionId", "number") DO NOTHING;

-- 4. CHECKLIST ITEMS
INSERT INTO "checklist_item" ("id", "sectionId", "number", "requirementText", "severity", "responseType", "selectOptions", "minPhotos", "maxPhotos", "allowsNa", "isRequired", "guidanceText", "order")
VALUES
  -- Items for QC-CIVIL-5G Section 1.0
  ('11111111-bbbb-0000-0000-000000000001', '11111111-aaaa-0000-0000-000000000001', '1.1', 'Anchor bolts tightened to calibrated torque specification (>= 180 Nm)', 'CRITICAL', 'PASS_FAIL', ARRAY[]::text[], 1, 3, false, true, 'Use torque wrench with valid calibration certificate; capture dial reading in photo.', 1),
  ('11111111-bbbb-0000-0000-000000000002', '11111111-aaaa-0000-0000-000000000001', '1.2', 'Non-shrink grout layer free from air pockets and cracks', 'MAJOR', 'PASS_FAIL', ARRAY[]::text[], 1, 2, false, true, 'Verify perimeter leveling pad is fully cured and chamfered at 45 degrees.', 2),
  -- Items for QC-CIVIL-5G Section 2.0
  ('11111111-bbbb-0000-0000-000000000003', '11111111-aaaa-0000-0000-000000000002', '2.1', 'Tower verticality plumb line measured within 1:1000 tolerance', 'CRITICAL', 'PASS_FAIL', ARRAY[]::text[], 1, 2, false, true, 'Measure using optical theodolite from two orthogonal directions at 90 degrees.', 1),
  ('11111111-bbbb-0000-0000-000000000004', '11111111-aaaa-0000-0000-000000000002', '2.2', 'Hot-dip galvanization coating thickness measured (>= 86 microns)', 'MINOR', 'NUMBER', ARRAY[]::text[], 0, 0, false, true, 'Measure average thickness across 5 spot checks with calibrated magnetic gauge.', 2),

  -- Items for QC-ELEC-5G Section 1.0
  ('22222222-bbbb-0000-0000-000000000001', '22222222-aaaa-0000-0000-000000000001', '1.1', 'Earth electrode resistance measurement (< 5 Ohms)', 'CRITICAL', 'NUMBER', ARRAY[]::text[], 1, 2, false, true, 'Measure with fall-of-potential tester (3-point clamp); record digital multimeter reading.', 1),
  ('22222222-bbbb-0000-0000-000000000002', '22222222-aaaa-0000-0000-000000000001', '1.2', 'Exothermic weld / copper clamp bonding integrity verified', 'MAJOR', 'PASS_FAIL', ARRAY[]::text[], 1, 2, false, true, 'Ensure no slag or porosity on CADWELD connection to tower earth ring.', 2),
  -- Items for QC-ELEC-5G Section 2.0
  ('22222222-bbbb-0000-0000-000000000003', '22222222-aaaa-0000-0000-000000000002', '2.1', 'Type 1 + 2 Class SPD status indicator green and operational', 'CRITICAL', 'PASS_FAIL', ARRAY[]::text[], 1, 1, false, true, 'Inspect AC main distribution box and DC power distribution unit SPD cartridges.', 1),

  -- Items for EHS-TOWER-SAFETY Section 1.0
  ('33333333-bbbb-0000-0000-000000000001', '33333333-aaaa-0000-0000-000000000001', '1.1', 'Full body harness, dual lanyards with shock absorber & hard hat inspected', 'CRITICAL', 'PASS_FAIL', ARRAY[]::text[], 1, 2, false, true, 'Verify EN 361 / ANSI Z359 certification tags and no webbing fraying or buckle wear.', 1),
  ('33333333-bbbb-0000-0000-000000000002', '33333333-aaaa-0000-0000-000000000001', '1.2', 'Fall arrest cable system (Lad-Saf) tested and certified on climbing ladder', 'CRITICAL', 'PASS_FAIL', ARRAY[]::text[], 1, 2, false, true, 'Test cable guide tension and top/bottom anchor karabiner locking pins.', 2)
ON CONFLICT ("sectionId", "number") DO NOTHING;

-- 5. WORK ORDERS
INSERT INTO "work_order" (
  "id", "projectId", "projectCode", "projectName",
  "siteId", "siteCode", "siteName", "siteCity", "siteArea",
  "templateId", "templateName", "workOrderType", "title", "status",
  "assigneeId", "plannedCompletionAt", "actualCompletionAt",
  "currentSubmissionId", "currentAttemptNo", "cancelReason", "createdBy", "createdAt"
)
VALUES
  (
    'f1111111-1111-1111-1111-111111111111',
    'a1111111-1111-1111-1111-111111111111', 'PRJ-5G-METRO', 'Kathmandu Valley 5G Metro Expansion',
    'c1111111-1111-1111-1111-111111111111', 'KTM-5G-001', 'Thamel Central Rooftop Hub', 'Kathmandu', 'Thamel Ward 26',
    '11111111-1111-1111-1111-111111111111', '5G Telecom Tower Civil Structure Quality Checklist',
    'QUALITY_SELF_CHECK', '[Quality Self-check] KTM-5G-001 - Civil Structure Inspection', 'REVIEWING',
    '01a0cdb7-e328-7000-bb83-32768f52d876', NOW() + INTERVAL '3 days', NULL,
    '55555555-1111-1111-1111-111111111111', 1, NULL, '01a0cdb7-e306-7000-8886-6ca6c8edb78c', NOW() - INTERVAL '4 days'
  ),
  (
    'f2222222-2222-2222-2222-222222222222',
    'a1111111-1111-1111-1111-111111111111', 'PRJ-5G-METRO', 'Kathmandu Valley 5G Metro Expansion',
    'c2222222-2222-2222-2222-222222222222', 'LAL-5G-014', 'Pulchowk Engineering Substation', 'Lalitpur', 'Pulchowk Ward 3',
    '22222222-2222-2222-2222-222222222222', 'Electrical Earthing, Surge & Lightning Protection Checklist',
    'QUALITY_SELF_CHECK', '[Quality Self-check] LAL-5G-014 - Electrical & Earthing Audit', 'RECTIFYING',
    '01a0cdb7-e328-7000-bb83-32768f52d876', NOW() + INTERVAL '1 day', NULL,
    '55555555-2222-2222-2222-222222222222', 1, NULL, '01a0cdb7-e306-7000-8886-6ca6c8edb78c', NOW() - INTERVAL '3 days'
  ),
  (
    'f3333333-3333-3333-3333-333333333333',
    'a1111111-1111-1111-1111-111111111111', 'PRJ-5G-METRO', 'Kathmandu Valley 5G Metro Expansion',
    'c3333333-3333-3333-3333-333333333333', 'BKT-5G-008', 'Bhaktapur Durbar Relay Node', 'Bhaktapur', 'Durbar Square',
    '33333333-3333-3333-3333-333333333333', 'Tower Climbing & Rigging Personal Safety Audit',
    'EHS_SPOT_CHECK', '[EHS Spot-check] BKT-5G-008 - Tower Rigging & Fall Arrest Inspection', 'ONGOING',
    '01a0cdb7-e328-7000-bb83-32768f52d876', NOW() + INTERVAL '5 days', NULL,
    NULL, NULL, NULL, '01a0cdb7-e318-7000-bb1d-b47c5143000e', NOW() - INTERVAL '2 days'
  ),
  (
    'f4444444-4444-4444-4444-444444444444',
    'a1111111-1111-1111-1111-111111111111', 'PRJ-5G-METRO', 'Kathmandu Valley 5G Metro Expansion',
    'c4444444-4444-4444-4444-444444444444', 'KTM-5G-009', 'Baluwatar Core Terminal', 'Kathmandu', 'Baluwatar Ward 4',
    '11111111-1111-1111-1111-111111111111', '5G Telecom Tower Civil Structure Quality Checklist',
    'QUALITY_SELF_CHECK', '[Quality Self-check] KTM-5G-009 - Final Site Quality Acceptance', 'COMPLETED',
    '01a0cdb7-e328-7000-bb83-32768f52d876', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day',
    '55555555-4444-4444-4444-444444444444', 1, NULL, '01a0cdb7-e306-7000-8886-6ca6c8edb78c', NOW() - INTERVAL '10 days'
  )
ON CONFLICT ("id") DO UPDATE SET
  "title" = EXCLUDED."title",
  "status" = EXCLUDED."status";

-- 6. WORK ORDER EVENTS (Timeline)
INSERT INTO "work_order_event" ("id", "workOrderId", "kind", "at", "actorId", "detail")
VALUES
  ('e1111111-0001-0000-0000-000000000001', 'f1111111-1111-1111-1111-111111111111', 'CREATED', NOW() - INTERVAL '4 days', '01a0cdb7-e306-7000-8886-6ca6c8edb78c', '{"reason": "Scheduled milestone civil quality verification"}'),
  ('e1111111-0001-0000-0000-000000000002', 'f1111111-1111-1111-1111-111111111111', 'SUBMITTED', NOW() - INTERVAL '4 hours', '01a0cdb7-e328-7000-bb83-32768f52d876', '{"submissionId": "55555555-1111-1111-1111-111111111111", "attemptNo": 1}'),

  ('e2222222-0001-0000-0000-000000000001', 'f2222222-2222-2222-2222-222222222222', 'CREATED', NOW() - INTERVAL '3 days', '01a0cdb7-e306-7000-8886-6ca6c8edb78c', '{"reason": "Site power energization earthing inspection"}'),
  ('e2222222-0001-0000-0000-000000000002', 'f2222222-2222-2222-2222-222222222222', 'SUBMITTED', NOW() - INTERVAL '1 day', '01a0cdb7-e328-7000-bb83-32768f52d876', '{"submissionId": "55555555-2222-2222-2222-222222222222", "attemptNo": 1}'),
  ('e2222222-0001-0000-0000-000000000003', 'f2222222-2222-2222-2222-222222222222', 'REJECTED', NOW() - INTERVAL '18 hours', '01a0cdb7-e318-7000-bb1d-b47c5143000e', '{"comment": "Earth resistance was measured at 7.8 Ohms; must be under 5 Ohms. Improve ground pit bentonite mix."}'),

  ('e3333333-0001-0000-0000-000000000001', 'f3333333-3333-3333-3333-333333333333', 'CREATED', NOW() - INTERVAL '2 days', '01a0cdb7-e318-7000-bb1d-b47c5143000e', '{"reason": "Ad-hoc EHS audit prior to antenna rigging on historical perimeter"}'),

  ('e4444444-0001-0000-0000-000000000001', 'f4444444-4444-4444-4444-444444444444', 'CREATED', NOW() - INTERVAL '10 days', '01a0cdb7-e306-7000-8886-6ca6c8edb78c', '{"reason": "Core hub completion handover"}'),
  ('e4444444-0001-0000-0000-000000000002', 'f4444444-4444-4444-4444-444444444444', 'SUBMITTED', NOW() - INTERVAL '2 days', '01a0cdb7-e328-7000-bb83-32768f52d876', '{"submissionId": "55555555-4444-4444-4444-444444444444", "attemptNo": 1}'),
  ('e4444444-0001-0000-0000-000000000003', 'f4444444-4444-4444-4444-444444444444', 'APPROVED', NOW() - INTERVAL '1 day', '01a0cdb7-e318-7000-bb1d-b47c5143000e', '{"comment": "All criteria met with flying colors. Site handed over for telecom integration."}')
ON CONFLICT ("id") DO NOTHING;

-- 7. SUBMISSIONS
INSERT INTO "submission" (
  "id", "taskId", "siteId", "projectId", "templateId", "templateVersionId", "templateVersion",
  "attemptNo", "status", "overallVerdict", "submittedBy", "submittedAt",
  "reviewedBy", "reviewedAt", "reviewComment",
  "integrityHash", "idempotencyKey", "deviceId", "latitude", "longitude", "distanceFromSiteM", "geofenceStatus"
)
VALUES
  (
    '55555555-1111-1111-1111-111111111111',
    'f1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111',
    '11111111-1111-1111-1111-111111111111', '11111111-0001-0000-0000-000000000001', 1,
    1, 'SUBMITTED', NULL, '01a0cdb7-e328-7000-bb83-32768f52d876', NOW() - INTERVAL '4 hours',
    NULL, NULL, NULL,
    'hash-ktm-001-civil-submission-sha256-verified', 'idemp-ktm-5g-001-attempt-1', 'Pixel-9-Pro-FieldDevice',
    27.7172450, 85.3139600, 12, 'VERIFIED'
  ),
  (
    '55555555-2222-2222-2222-222222222222',
    'f2222222-2222-2222-2222-222222222222', 'c2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222', '22222222-0001-0000-0000-000000000001', 1,
    1, 'RECTIFICATION_REQUESTED', 'FAIL', '01a0cdb7-e328-7000-bb83-32768f52d876', NOW() - INTERVAL '1 day',
    '01a0cdb7-e318-7000-bb1d-b47c5143000e', NOW() - INTERVAL '18 hours', 'Earth resistance was measured at 7.8 Ohms; must be under 5 Ohms. Improve ground pit bentonite mix.',
    'hash-lal-014-elec-submission-sha256-verified', 'idemp-lal-5g-014-attempt-1', 'Galaxy-S24-Ultra-FieldDevice',
    27.6811200, 85.3188500, 8, 'VERIFIED'
  ),
  (
    '55555555-4444-4444-4444-444444444444',
    'f4444444-4444-4444-4444-444444444444', 'c4444444-4444-4444-4444-444444444444', 'a1111111-1111-1111-1111-111111111111',
    '11111111-1111-1111-1111-111111111111', '11111111-0001-0000-0000-000000000001', 1,
    1, 'APPROVED', 'PASS', '01a0cdb7-e328-7000-bb83-32768f52d876', NOW() - INTERVAL '2 days',
    '01a0cdb7-e318-7000-bb1d-b47c5143000e', NOW() - INTERVAL '1 day', 'All criteria met with flying colors. Site handed over for telecom integration.',
    'hash-ktm-009-civil-submission-sha256-verified', 'idemp-ktm-5g-009-attempt-1', 'Pixel-9-Pro-FieldDevice',
    27.7289000, 85.3321000, 15, 'VERIFIED'
  )
ON CONFLICT ("taskId", "attemptNo") DO NOTHING;

-- 8. ITEM RESPONSES FOR SUBMISSION 1 (KTM-5G-001)
INSERT INTO "item_response" (
  "id", "submissionId", "itemId", "selfCheckResult", "selfCheckDescription",
  "textValue", "numberValue", "booleanValue", "selectValue", "reviewResult", "reviewDescription"
)
VALUES
  ('66666666-1111-0000-0000-000000000001', '55555555-1111-1111-1111-111111111111', '11111111-bbbb-0000-0000-000000000001', 'PASS', 'Torqued with Norbar Pro 300 to 195 Nm on all 8 M24 foundation studs.', NULL, 195.0, true, NULL, 'PENDING', NULL),
  ('66666666-1111-0000-0000-000000000002', '55555555-1111-1111-1111-111111111111', '11111111-bbbb-0000-0000-000000000002', 'PASS', 'SikaGrout-214 poured and cured 72 hrs. No voids or cracking.', NULL, NULL, true, NULL, 'PENDING', NULL),
  ('66666666-1111-0000-0000-000000000003', '55555555-1111-1111-1111-111111111111', '11111111-bbbb-0000-0000-000000000003', 'PASS', 'Plumb deviation measured 8mm over 24m mast height (well within 24mm limit).', NULL, NULL, true, NULL, 'PENDING', NULL),
  ('66666666-1111-0000-0000-000000000004', '55555555-1111-1111-1111-111111111111', '11111111-bbbb-0000-0000-000000000004', 'PASS', 'Elcometer average 98.4 microns across 5 test points.', NULL, 98.4000, true, NULL, 'PENDING', NULL)
ON CONFLICT ("submissionId", "itemId") DO NOTHING;

-- 9. ITEM RESPONSES FOR SUBMISSION 2 (LAL-5G-014 - FAILED)
INSERT INTO "item_response" (
  "id", "submissionId", "itemId", "selfCheckResult", "selfCheckDescription",
  "textValue", "numberValue", "booleanValue", "selectValue", "reviewResult", "reviewDescription", "reviewedBy", "reviewedAt"
)
VALUES
  ('66666666-2222-0000-0000-000000000001', '55555555-2222-2222-2222-222222222222', '22222222-bbbb-0000-0000-000000000001', 'FAIL', 'High soil resistivity. Measured 7.8 Ohms with Fluke 1625 tester.', NULL, 7.8000, false, NULL, 'REJECTED', 'Resistance exceeds 5 Ohm maximum contract specification.', '01a0cdb7-e318-7000-bb1d-b47c5143000e', NOW() - INTERVAL '18 hours'),
  ('66666666-2222-0000-0000-000000000002', '55555555-2222-2222-2222-222222222222', '22222222-bbbb-0000-0000-000000000002', 'PASS', 'CADWELD mold #4 solid copper connection good.', NULL, NULL, true, NULL, 'APPROVED', 'Welds pass visual and hammer test.', '01a0cdb7-e318-7000-bb1d-b47c5143000e', NOW() - INTERVAL '18 hours'),
  ('66666666-2222-0000-0000-000000000003', '55555555-2222-2222-2222-222222222222', '22222222-bbbb-0000-0000-000000000003', 'PASS', 'Dehn Ventil modular SPD installed and healthy.', NULL, NULL, true, NULL, 'APPROVED', 'Green flags visible.', '01a0cdb7-e318-7000-bb1d-b47c5143000e', NOW() - INTERVAL '18 hours')
ON CONFLICT ("submissionId", "itemId") DO NOTHING;

COMMIT;
