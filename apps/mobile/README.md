# iPMS Field App (Flutter)

The field client for iPMS. Everything it shows comes live from the API gateway;
photos go straight from the phone to the media bucket through presigned URLs.

## Running against the stack

Start the backend (`docker compose -f docker/docker-compose.yml up -d` from the
repo root), then:

```sh
flutter run                                              # gateway at http://localhost:3000
flutter run --dart-define=API_BASE_URL=http://192.168.1.20:3000   # physical iPhone: use the Mac's LAN IP
```

Android (emulator or USB device) reaches the host through `adb reverse`. Photo
uploads go to the bucket host baked into presigned URLs (`S3_PUBLIC_ENDPOINT`
in `docker/env/media.env`, `http://localhost:9000` locally), so forward that
port too:

```sh
adb reverse tcp:3000 tcp:3000   # gateway
adb reverse tcp:9000 tcp:9000   # MinIO (local stand-in for R2)
```

On a physical iPhone, set `S3_PUBLIC_ENDPOINT` to the Mac's LAN address as well,
or uploads will fail with a connection error. Against R2 no forwarding is needed.

Sign in as `engineer@ipms.local` with the demo password (`IAM_DEMO_PASSWORD` in
`docker/env/iam.env`) to see the field engineer's assigned work orders.

### Demo mode

`--dart-define=DEMO_MODE=true` restores the offline sample data (projects,
work orders, checklists, and a sign-in that works without a server). It is off
by default so a gateway failure is shown rather than hidden behind samples.
In demo mode nothing is uploaded or submitted.

## What the app calls

| Screen | Endpoint | Service |
| :--- | :--- | :--- |
| Sign in / session | `POST /api/v1/auth/login`, `/refresh`, `/logout`, `GET /auth/me`, `GET`/`PATCH /users/me` | iam |
| Projects, sites | `GET /api/v1/projects`, `GET /api/v1/projects/:id` | project |
| Tasks (work orders) | `GET /api/v1/work-orders?assigneeId=…`, `GET /api/v1/work-orders/:id` | qc |
| Checklist | `GET /api/v1/qc/tasks/:workOrderId/checklist` | qc |
| Submit to QC | `POST /api/v1/qc/submissions` | qc |
| Rework feedback | `GET /api/v1/qc/submissions/:id` | qc |
| Assignee names | `GET /api/v1/users/directory` | iam |
| Photo upload | `POST /api/v1/media/uploads` → `PUT` presigned URL → `POST /media/uploads/:id/complete` → `POST /media/uploads/status` | media + bucket |
| Delete a photo | `DELETE /api/v1/media/:id` | media |

Paths live in `lib/core/config/api_endpoints.dart`.

## Sign-in and Face ID / fingerprint

After a password sign-in the app offers to turn on biometric sign-in. Once on:

- **Log Out** locks the app. The session kept for biometrics stays valid on the
  server, so Face ID / fingerprint reopens it.
- **Sign out & forget device** (in the logout dialog) revokes every session on
  the server and turns biometrics off on this phone.
- If the kept session has expired or been revoked (password changed, 30 days
  unused), Face ID says so and one password sign-in re-arms it.
- A different account signing in on the same phone removes the previous
  user's biometric enrollment, and starts with its own tasks and photos.
- An account that must change its password is told to do so on the web.

When the server refuses to refresh a session mid-use, the app returns to the
sign-in screen.

## Photo evidence

1. Capture: the photo is watermarked and saved as JPEG (≤ 5 MB) in app-private
   storage, with a UUIDv7 that becomes its media id.
2. Once the photo is on a checklist item it uploads in the background
   (`EvidenceUploader`): register with its SHA-256, `PUT` the bytes to the
   bucket, `complete`, then poll until the server has verified it. The cloud
   badge on each thumbnail shows progress; tap a red one to retry.
3. Submit to QC waits for every attached photo to be `READY`, then sends the
   checklist responses with their media ids.

Retries reuse the same media id, so a dropped connection never creates a
duplicate. A photo the server rejects is sent again under a new id.

The phone remembers its photos and their upload state per account (a small
index next to the photos in app-private storage), so closing the app loses
nothing: reopening a work order resumes interrupted uploads. Submitted photos
are deleted from the phone after 30 days.

Work orders sent back by QC ("Rework") show the reviewer's comment and flag
each rejected item with its note.

## Checks

```sh
flutter analyze
flutter test

# Against a running stack: creates a work order as admin, then loads it,
# uploads a photo to the bucket and submits it as the engineer.
IPMS_E2E_URL=http://localhost:3000 flutter test test/e2e
```
