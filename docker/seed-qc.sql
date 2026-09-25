-- ====================================================================
-- iPMS Comprehensive Seed Data for Quality Control Database (ipms_qc)
-- ====================================================================

BEGIN;

-- Checklist Templates
INSERT INTO "checklist_template" ("id", "projectId", "code", "name", "category", "version", "status", "publishedAt", "createdBy", "source")
VALUES
  ('11111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'QC-CIVIL-5G', '5G Telecom Tower Civil Structure Quality Checklist', 'CIVIL', 1, 'PUBLISHED', NOW(), '01a0cdb7-e318-7000-bb1d-b47c5143000e', 'WEB'),
  ('22222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111', 'QC-ELEC-5G', 'Electrical Earthing, Surge & Lightning Protection Checklist', 'ELECTRICAL', 1, 'PUBLISHED', NOW(), '01a0cdb7-e318-7000-bb1d-b47c5143000e', 'WEB')
ON CONFLICT ("projectId", "code", "version") DO NOTHING;

-- Sections for Template 1
INSERT INTO "checklist_section" ("id", "templateId", "number", "title", "order")
VALUES
  ('33333333-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '1.0', 'Base Plate & Anchor Bolt Assembly', 1),
  ('33333333-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '2.0', 'Mast Verticality & Torque Inspection', 2)
ON CONFLICT ("templateId", "number") DO NOTHING;

-- Items for Section 1.0
INSERT INTO "checklist_item" ("id", "sectionId", "number", "requirementText", "severity", "responseType", "requiresPhoto", "minPhotos", "maxPhotos", "order")
VALUES
  ('44444444-1111-1111-1111-111111111111', '33333333-1111-1111-1111-111111111111', '1.1', 'Anchor bolts tightened to calibrated torque specification (>= 180 Nm)', 'CRITICAL', 'PASS_FAIL', true, 1, 3, 1),
  ('44444444-2222-2222-2222-222222222222', '33333333-1111-1111-1111-111111111111', '1.2', 'Non-shrink grout layer free from air pockets and cracks', 'MAJOR', 'PASS_FAIL', true, 1, 2, 2)
ON CONFLICT ("sectionId", "number") DO NOTHING;

-- Items for Section 2.0
INSERT INTO "checklist_item" ("id", "sectionId", "number", "requirementText", "severity", "responseType", "requiresPhoto", "minPhotos", "maxPhotos", "order")
VALUES
  ('44444444-3333-3333-3333-333333333333', '33333333-2222-2222-2222-222222222222', '2.1', 'Tower verticality plumb line measured within 1:1000 tolerance', 'CRITICAL', 'PASS_FAIL', true, 1, 2, 1),
  ('44444444-4444-4444-4444-444444444444', '33333333-2222-2222-2222-222222222222', '2.2', 'Hot-dip galvanization coating thickness measured (>= 86 microns)', 'MINOR', 'NUMBER', false, 0, 0, 2)
ON CONFLICT ("sectionId", "number") DO NOTHING;

-- Submissions
INSERT INTO "submission" ("id", "taskId", "siteId", "projectId", "templateId", "templateVersion", "attemptNo", "status", "submittedBy", "submittedAt", "integrityHash", "idempotencyKey", "geofenceStatus", "latitude", "longitude")
VALUES
  ('55555555-1111-1111-1111-111111111111', 'f1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 1, 1, 'SUBMITTED', '01a0cdb7-e328-7000-bb83-32768f52d876', NOW(), 'hash-proof-ktm-001-integrity-verified-5g', 'idemp-ktm-5g-001-v1', 'VERIFIED', 27.7172450, 85.3139600),
  ('55555555-2222-2222-2222-222222222222', 'f2222222-2222-2222-2222-222222222222', 'c2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 1, 1, 'RECTIFICATION_REQUESTED', '01a0cdb7-e328-7000-bb83-32768f52d876', NOW() - INTERVAL '1 day', 'hash-proof-lal-014-integrity-verified-5g', 'idemp-lal-5g-014-v1', 'VERIFIED', 27.6811200, 85.3188500)
ON CONFLICT ("taskId", "attemptNo") DO NOTHING;

COMMIT;
