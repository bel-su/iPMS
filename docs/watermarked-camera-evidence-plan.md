# Architectural Implementation Plan: Field Operations Workflow & GPS-Watermarked Evidence

**Feature Title:** End-to-End Field Operations: Projects, Sites, Tasks & GPS-Watermarked Photo Evidence Submission  
**Target Module:** `apps/mobile/` (Flutter 3.44+ / Android 14)  
**Target Platform:** Mobile App Client connecting to iPMS Microservices Backend  
**Document Version:** 2.0.0  
**Status:** Approved for Implementation  

---

## 1. Executive Summary & Complete Field Journey

The **iPMS Field App** provides field engineers, technicians, and riggers with a structured, step-by-step workflow from assignment to delivery verification.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FIELD ENGINEER JOURNEY                          │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ 1. ASSIGNED PROJECTS LIST   │
                    │ View active projects        │
                    │ (e.g. Kathmandu 5G Metro)   │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ 2. SITES SELECTION & MAP    │
                    │ View sites under project    │
                    │ GPS navigation on OSM       │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ 3. ASSIGNED TASKS LIST      │
                    │ Filter tasks at that site   │
                    │ Status: Ongoing, Review...  │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ 4. HARDWARE CAMERA CAPTURE  │
                    │ Snap photo on-site          │
                    │ Fetch live device GPS       │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ 5. BOTTOM-LEFT WATERMARK    │
                    │ Burn User, Site, Project,   │
                    │ Lat/Long, Timestamp into px │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ 6. SUBMIT TO QC / MANAGER   │
                    │ Send evidence bundle to     │
                    │ authorized person for review│
                    └─────────────────────────────┘
```

---

## 2. Information Architecture & Navigation

The mobile application establishes a clear 3-tier hierarchy:

### Tier 1: Projects (`ProjectListScreen` / Project Selector)
* Displays active projects assigned to the engineer.
* Shows: Project Code (`PRJ-5G-METRO`), Project Name, Client, Total Sites, Total Tasks, and Status badge.
* Tapping a project navigates to its **Sites & Tasks**.

### Tier 2: Sites (`SiteListScreen` & `SiteMapScreen`)
* Lists all cell sites, tower locations, or trench routes belonging to the selected project.
* Shows: Site Code (`KOS121`), Name (`Kathmandu Central Hub`), City/Region, Live Distance from user (`2.4 km away`), and Geofence status.
* Interactive toggle between **List View** and **OpenStreetMap View**.
* Tapping a site filters and opens the **Tasks for that Site**.

### Tier 3: Tasks (`TaskListScreen` & `TaskDetailScreen`)
* Shows work packages assigned at the site (e.g. `Civil Works & Tower Foundation`, `5G Antenna Installation`).
* Shows Checklist items, Planned Deadline, Status (`ONGOING`, `REVIEWING`, `COMPLETED`), and Priority.
* Contains the **"📷 Capture Photo Evidence"** button.

---

## 3. Watermark Specification (Bottom-Left Burned Canvas)

The watermark is **rendered and burned directly into the image's raw pixels** via `dart:ui.Canvas`. It cannot be stripped, cropped easily, or lost during file sharing.

### Visual Mockup (Bottom-Left Position — Monochrome & Professional)
```text
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│                                                                        │
│                       [ Captured Site Photo ]                          │
│                   Tower / Antenna / Civil Works                        │
│                                                                        │
│                                                                        │
│ ┌──────────────────────────────────────────────────────────┐           │
│ │ [VERIFIED] iPMS SECURE FIELD EVIDENCE                    │           │
│ │ Engineer: engineer (Field Engineer)                      │           │
│ │ Site: KOS121 — Kathmandu Central Hub                     │           │
│ │ Project: PRJ-5G-METRO (Kathmandu Valley 5G Expansion)    │           │
│ │ GPS: 27.717240 N, 85.324010 E (Accuracy: +/-3.2m)        │           │
│ │ Timestamp: 2026-09-25 11:05:42 NPT (Local Time)          │           │
│ └──────────────────────────────────────────────────────────┘           │
└────────────────────────────────────────────────────────────────────────┘
                       ▲
         Positioned at Bottom-Left with 85% Dark Charcoal Card
```

### Exact Metadata Fields (Clean Typography, No Colorful Emojis):
1. **System Seal**: `[VERIFIED] iPMS SECURE FIELD EVIDENCE`
2. **User Identity**: `Engineer: {username} ({fullName})`
3. **Site Identity**: `Site: [{siteCode}] {siteName}`
4. **Project Identity**: `Project: [{projectCode}] {projectName}`
5. **GPS Coordinates**: `GPS: {latitude} N/S, {longitude} E/W (Accuracy: +/-{accuracy}m)`
6. **Live Timestamp**: `Timestamp: {YYYY-MM-DD HH:mm:ss} {TimeZone}`
7. **Design Rule**: No colorful emojis are used in the UI or watermark. Clean monochrome vector icons (`Icons.camera_alt_outlined`, `Icons.location_on_outlined`, `Icons.verified_outlined`) and high-contrast typography are used exclusively.

---

## 4. Evidence Submission to Authorized Persons (Manager / QC)

Once photo evidence is captured and watermarked:
1. **Local Preview & Verification**:
   * The engineer reviews the watermarked photo thumbnail in the **Site Evidence Gallery**.
   * Can tap to open a full-screen pinch-to-zoom modal to inspect photo clarity and watermark legibility.
2. **Submission Dispatch**:
   * Engineer taps **"Submit Evidence to Reviewer"**.
   * Creates a formal submission bundle linked to the `taskId`, `siteId`, and `projectId`.
   * Dispatches via API Gateway (`POST /api/v1/qc/submissions`).
   * Task status moves from `ONGOING` to `REVIEWING`.
3. **Authorized Manager / QC Verification**:
   * The submission immediately appears on the **Web Dashboard** for the Project Manager / QC Verifier.
   * Authorized verifier views the watermarked photo with tamper-evident coordinates, verifies site geofence, and marks **Approved** or **Reject with Rework Notes**.

---

## 5. File Modification & Implementation Plan

### Phase 1: Models & Repositories
* **`lib/features/projects/domain/models/project_item.dart`** (New):
  - Model for Project list (`id`, `code`, `name`, `status`, `siteCount`, `taskCount`).
* **`lib/features/projects/data/project_repository.dart`** (New):
  - Calls `GET /api/v1/projects` and `GET /api/v1/projects/:id` to fetch live projects and their sites.
* **`lib/features/projects/providers/project_providers.dart`** (New):
  - Riverpod provider for active projects and selected project state.
* **`lib/features/tasks/domain/models/task_evidence.dart`** (New):
  - Model holding captured watermarked evidence (`id`, `taskId`, `filePath`, `siteCode`, `siteName`, `projectCode`, `lat`, `long`, `capturedAt`, `isSubmitted`).
* **`lib/features/tasks/providers/evidence_provider.dart`** (New):
  - Manages the local collection of captured evidence per task and handles submission dispatch.

### Phase 2: Watermark Graphics Engine
* **`lib/core/services/watermark_service.dart`** (New):
  - High-performance `dart:ui.Canvas` compositor.
  - Dynamically calculates scale relative to camera resolution.
  - Draws semi-transparent bottom-left card (`#1E1E2F` at 85% opacity, rounded corners `16px`).
  - Renders crisp vector text with anti-aliasing.
  - Compresses to standard evidence image file saved in app cache.

### Phase 3: Hardware Camera & GPS Integration
* **`lib/core/services/camera_service.dart`** (New):
  - Requests hardware camera via `ImagePicker`.
  - Concurrently queries `Geolocator.getCurrentPosition(desiredAccuracy: LocationAccuracy.high)`.
  - Handles permission prompts and fallback if GPS is indoors or delayed.

### Phase 4: UI & Screens
* **`lib/features/projects/presentation/project_list_screen.dart`** (New):
  - Clean card-based screen showing assigned projects with completion progress and site counts.
* **`lib/features/tasks/presentation/task_detail_screen.dart`** (Updated):
  - 3 Tabs: **Checklist**, **Site Evidence (Photos & Submission)**, and **Site & Coordinates**.
  - **Site Evidence Tab**:
    - "📷 Take Watermarked Photo" button.
    - Gallery of captured photos with bottom-left watermark badge.
    - Fullscreen interactive zoom viewer (`PhotoPreviewModal`).
    - "🚀 Submit Evidence to QC / Manager" action button.

---

## 6. Verification & Test Plan

1. **Hardware Camera**: Test on physical device **RMX3630** to ensure camera opens and returns photo.
2. **GPS Accuracy**: Confirm live latitude/longitude matches device location in Nepal.
3. **Bottom-Left Watermark**: Inspect the resulting `.jpg` file to verify that the watermark is positioned cleanly at the bottom-left with crisp white typography.
4. **Project -> Site -> Task Flow**: Verify navigating from project list into sites and tasks operates seamlessly.
5. **Static Code Quality**: Ensure `flutter analyze` passes with **0 errors and 0 warnings**.
