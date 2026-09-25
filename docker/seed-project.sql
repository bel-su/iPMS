-- ====================================================================
-- iPMS Comprehensive Seed Data for Project and QC Databases
-- ====================================================================

-- 1. SEED PROJECT DATABASE (ipms_project)
-- Connect to ipms_project before running these statements.

BEGIN;

-- Projects
INSERT INTO "project" ("id", "code", "name", "client_name", "phase", "status", "startDate", "targetDate", "defaultGeofenceRadiusM", "createdAt", "updatedAt")
VALUES
  ('a1111111-1111-1111-1111-111111111111', 'PRJ-5G-METRO', 'Kathmandu Valley 5G Metro Expansion', 'Nepal Telecom Corp', 'Phase 2 - Radio Access Network', 'ACTIVE', '2026-01-15', '2026-12-31', 500, NOW(), NOW()),
  ('a2222222-2222-2222-2222-222222222222', 'PRJ-FIBER-01', 'Nationwide Optical Fiber Backbone', 'National Infrastructure Authority', 'Phase 1 - Civil Ducts & Trenching', 'ACTIVE', '2026-03-01', '2027-06-30', 750, NOW(), NOW()),
  ('a3333333-3333-3333-3333-333333333333', 'PRJ-SOLAR-09', 'Rural Off-Grid Solar Power Towers', 'Rural Telecom Development Fund', 'Pilot Feasibility', 'DRAFT', '2026-09-01', '2027-02-28', 500, NOW(), NOW())
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "client_name" = EXCLUDED."client_name",
  "phase" = EXCLUDED."phase",
  "status" = EXCLUDED."status",
  "updatedAt" = NOW();

-- Regions
INSERT INTO "region" ("id", "projectId", "name")
VALUES
  ('b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'Kathmandu Central'),
  ('b2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111', 'Lalitpur Urban'),
  ('b3333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111', 'Bhaktapur Sub-division')
ON CONFLICT ("projectId", "name") DO NOTHING;

-- Sites
INSERT INTO "site" ("id", "projectId", "regionId", "siteCode", "name", "latitude", "longitude", "geofenceMode", "geofenceRadiusM", "address", "city", "status")
VALUES
  ('c1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 'KTM-5G-001', 'Thamel Central Rooftop Hub', 27.7172453, 85.3139605, 'INHERIT', 500, 'Thamel Marg, Ward 26', 'Kathmandu', 'IN_DELIVERY'),
  ('c2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222', 'LAL-5G-014', 'Pulchowk Engineering Substation', 27.6811200, 85.3188500, 'INHERIT', 500, 'Pulchowk Main Road', 'Lalitpur', 'IN_DELIVERY'),
  ('c3333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111', 'b3333333-3333-3333-3333-333333333333', 'BKT-5G-008', 'Bhaktapur Durbar Relay Node', 27.6710220, 85.4298200, 'INHERIT', 500, 'Durbar Square Perimeter', 'Bhaktapur', 'PLANNED'),
  ('c4444444-4444-4444-4444-444444444444', 'a1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 'KTM-5G-009', 'Baluwatar Core Terminal', 27.7289000, 85.3321000, 'CUSTOM', 300, 'Prime Minister Residence Road', 'Kathmandu', 'COMPLETED')
ON CONFLICT ("projectId", "siteCode") DO UPDATE SET
  "name" = EXCLUDED."name",
  "status" = EXCLUDED."status";

-- Task Types
INSERT INTO "task_type" ("id", "projectId", "code", "name", "category", "order", "isActive")
VALUES
  ('d1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'CIVIL-FOUNDATION', 'Antenna Mast Foundation Quality Inspection', 'CIVIL', 1, true),
  ('d2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111', 'ELEC-EARTHING', 'Surge Protection & Earthing Resistance', 'ELECTRICAL', 2, true),
  ('d3333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111', 'RF-COMMISSIONING', '5G Massive MIMO Antenna Alignment', 'TELECOM', 3, true),
  ('d4444444-4444-4444-4444-444444444444', 'a1111111-1111-1111-1111-111111111111', 'ENV-SAFETY', 'Aviation Light & Tower Safety Audit', 'SAFETY', 4, true)
ON CONFLICT ("projectId", "code") DO NOTHING;

-- Milestones
INSERT INTO "milestone" ("id", "projectId", "code", "name", "kind", "sequence")
VALUES
  ('e1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'M1-CIVIL', 'Structural Civil Ready', 'STANDARD', 1),
  ('e2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111', 'M2-POWER', 'Substation Power Energized', 'CRITICAL', 2),
  ('e3333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111', 'M3-RF-ONAIR', 'First 5G Radio Call On-Air', 'CRITICAL', 3)
ON CONFLICT ("projectId", "code") DO NOTHING;

-- Milestone Requirements
INSERT INTO "milestone_requirement" ("milestoneId", "taskTypeId")
VALUES
  ('e1111111-1111-1111-1111-111111111111', 'd1111111-1111-1111-1111-111111111111'),
  ('e2222222-2222-2222-2222-222222222222', 'd2222222-2222-2222-2222-222222222222'),
  ('e3333333-3333-3333-3333-333333333333', 'd3333333-3333-3333-3333-333333333333')
ON CONFLICT ("milestoneId", "taskTypeId") DO NOTHING;

-- Tasks (assignee: engineer, createdBy: manager)
INSERT INTO "task" ("id", "projectId", "siteId", "taskTypeId", "title", "status", "assigneeId", "origin", "createdBy", "plannedCompletionAt")
VALUES
  ('f1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'd1111111-1111-1111-1111-111111111111', 'Rooftop Mast Base Concrete & Torque Inspection', 'REVIEWING', '01a0cdb7-e328-7000-bb83-32768f52d876', 'PLANNED', '01a0cdb7-e306-7000-8886-6ca6c8edb78c', NOW() + INTERVAL '3 days'),
  ('f2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111', 'c2222222-2222-2222-2222-222222222222', 'd2222222-2222-2222-2222-222222222222', 'Ground Ring Resistance & Earthing Clamp Check', 'RECTIFYING', '01a0cdb7-e328-7000-bb83-32768f52d876', 'PLANNED', '01a0cdb7-e306-7000-8886-6ca6c8edb78c', NOW() + INTERVAL '1 days'),
  ('f3333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'd3333333-3333-3333-3333-333333333333', 'Sector A & B 5G Radio Unit Installation & Azimuth Calibration', 'ONGOING', '01a0cdb7-e328-7000-bb83-32768f52d876', 'PLANNED', '01a0cdb7-e306-7000-8886-6ca6c8edb78c', NOW() + INTERVAL '5 days'),
  ('f4444444-4444-4444-4444-444444444444', 'a1111111-1111-1111-1111-111111111111', 'c4444444-4444-4444-4444-444444444444', 'd4444444-4444-4444-4444-444444444444', 'Solar & Aviation Warning Light Operational Test', 'COMPLETED', '01a0cdb7-e328-7000-bb83-32768f52d876', 'PLANNED', '01a0cdb7-e306-7000-8886-6ca6c8edb78c', NOW() - INTERVAL '2 days')
ON CONFLICT ("id") DO UPDATE SET
  "status" = EXCLUDED."status";

COMMIT;
