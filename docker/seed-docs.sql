-- ====================================================================
-- iPMS Documentation Seed Data (ipms_docs)
-- ====================================================================

BEGIN;

INSERT INTO "document" ("id", "slug", "title", "category", "summary", "bodyMd", "version", "isPublished", "updatedBy", "updatedAt")
VALUES
  (
    '88888888-1111-1111-1111-111111111111',
    'qc-5g-inspection-sop',
    'Standard Operating Procedure: 5G RAN Quality & Civil Auditing',
    'QUALITY',
    'Guidelines for field engineers performing mast foundation torque, plumbness, and grout inspections.',
    '# Standard Operating Procedure: 5G RAN Quality Auditing

## 1. Scope
This procedure applies to all field engineers conducting Quality and Civil checks on 5G rooftop and greenfield towers in the Kathmandu Valley Expansion project.

## 2. Prerequisites
- Calibrated digital torque wrench (Norbar or equivalent, calibration certificate < 6 months old).
- Optical theodolite or calibrated laser level.
- Geofenced mobile device with high-accuracy GPS (< 15m radius accuracy).

## 3. Critical Verification Steps
1. **Foundation Studs**: Torque all anchor studs to minimum 180 Nm in star pattern.
2. **Grout Inspection**: Check perimeter leveling pad for honeycombing or shrinkage fissures.
3. **Photographic Evidence**: Capture geotagged photo with embedded timestamp watermark and torque gauge reading.',
    1, true, '01a0cdb7-e2e2-7000-80c3-4d088c0aaf33', NOW()
  ),
  (
    '88888888-2222-2222-2222-222222222222',
    'tower-safety-and-ehs-protocol',
    'EHS Protocol: Tower Rigging and Working at Heights',
    'SAFETY',
    'Mandatory safety requirements, personal protective equipment specifications, and fall arrest procedures.',
    '# EHS Protocol: Tower Rigging and Working at Heights

## 1. Mandatory PPE
All personnel entering tower climbing perimeters must be equipped with:
- EN 361 full-body harness with sternal and dorsal attachment points.
- Twin-tail energy absorbing lanyards with double-action scaffolding hooks.
- Industrial safety helmet with 4-point chinstrap (EN 397 / EN 12492).

## 2. 100% Tie-Off Policy
Under no circumstances may a technician detach both lanyard hooks simultaneously when traversing structural tower sections above 2 meters.',
    1, true, '01a0cdb7-e2e2-7000-80c3-4d088c0aaf33', NOW()
  )
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "document_version" ("id", "documentId", "version", "bodyMd", "createdAt")
VALUES
  (
    '88888888-aaaa-0000-0000-000000000001',
    '88888888-1111-1111-1111-111111111111',
    1,
    '# Standard Operating Procedure: 5G RAN Quality Auditing

## 1. Scope
This procedure applies to all field engineers conducting Quality and Civil checks on 5G rooftop and greenfield towers in the Kathmandu Valley Expansion project.

## 2. Prerequisites
- Calibrated digital torque wrench (Norbar or equivalent, calibration certificate < 6 months old).
- Optical theodolite or calibrated laser level.
- Geofenced mobile device with high-accuracy GPS (< 15m radius accuracy).

## 3. Critical Verification Steps
1. **Foundation Studs**: Torque all anchor studs to minimum 180 Nm in star pattern.
2. **Grout Inspection**: Check perimeter leveling pad for honeycombing or shrinkage fissures.
3. **Photographic Evidence**: Capture geotagged photo with embedded timestamp watermark and torque gauge reading.',
    NOW()
  ),
  (
    '88888888-aaaa-0000-0000-000000000002',
    '88888888-2222-2222-2222-222222222222',
    1,
    '# EHS Protocol: Tower Rigging and Working at Heights

## 1. Mandatory PPE
All personnel entering tower climbing perimeters must be equipped with:
- EN 361 full-body harness with sternal and dorsal attachment points.
- Twin-tail energy absorbing lanyards with double-action scaffolding hooks.
- Industrial safety helmet with 4-point chinstrap (EN 397 / EN 12492).

## 2. 100% Tie-Off Policy
Under no circumstances may a technician detach both lanyard hooks simultaneously when traversing structural tower sections above 2 meters.',
    NOW()
  )
ON CONFLICT ("documentId", "version") DO NOTHING;

COMMIT;
