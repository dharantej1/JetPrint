# JetPrint Cloud Relay Server & Mobile UI

Phase 1 of JetPrint: a Node.js + TypeScript + Express + `ws` relay server that connects local Kiosk apps via WebSocket and serves a mobile-responsive web app at `GET /upload?machine_id=XYZ`.

## Setup

```bash
cd cloud-relay
cp .env.example .env
npm install
npm run dev
```

Build & run production:

```bash
npm run build
npm start
```

Run automated tests:

```bash
npm test
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP & WebSocket server port | `3000` |
| `PUBLIC_URL` | Public base URL for file download links | Auto-detected from request host |
| `RAZORPAY_KEY_ID` | Razorpay Key ID (omit for Dev/Test mode) | `""` |
| `RAZORPAY_KEY_SECRET` | Razorpay Key Secret (omit for Dev/Test mode) | `""` |
| `RAZORPAY_WEBHOOK_SECRET` | HMAC-SHA256 secret for `POST /api/webhooks/razorpay` | `""` |
| `DEFAULT_BW_PRICE_PAISE` | Default B&W price per page in paise | `200` (₹2.00) |
| `DEFAULT_COLOR_PRICE_PAISE` | Default Color price per page in paise | `1000` (₹10.00) |
| `UPLOAD_DIR` | Temporary directory for uploaded files | `./uploads` |
| `FILE_TTL_MS` | File retention TTL in milliseconds | `3600000` (1 hour) |

## Orientation Fidelity & Document Pre-Flight

Cloud Relay includes an automated pre-flight analysis and document normalization pipeline:

- **JPEG EXIF Auto-Rotation (`getJpegExifOrientation`)**: Parses embedded EXIF metadata tags (1, 3, 6, 8) in camera and mobile photo uploads, mapping rotations to degrees (`exifOrientationToDegrees`) and orienting images upright before PDF conversion.
- **Client & Server-Side Aspect Ratio Detection**: Inspects PDF viewports (PDF.js in `public/app.js` and `pdf-lib` in `src/pdf.ts`) and image natural dimensions to automatically set page orientation (`portrait` vs `landscape`).
- **PDF Normalization & Print-Ready Composing (`buildPrintReadyPdf`)**: When documents have rotated pages, landscape aspect ratios, or non-standard media boxes, Cloud Relay normalizes them into standard PDF containers tagged `print_ready: true`. Kiosk print spoolers can then output these files directly without trigger-happy printer driver auto-rotation or margin clipping.

## HTTP Endpoints

- `GET /upload?machine_id=<id>` — Mobile-responsive upload & UPI payment UI
- `GET /api/health` — Health & mode check
- `GET /api/machines/:machineId` — Kiosk online status & pricing (`bwPerPagePaise`, `colorPerPagePaise`, `shopName`, `supportedPaperSizes`)
- `GET /api/machines/:machineId/active-jobs` — Active jobs synchronization; returns all unprinted/unacknowledged jobs for the machine (requires `Authorization: Bearer <auth_token>` or `?token=<auth_token>`)
- `GET /api/jobs/by-otp/:otp` — On-demand OTP lookup fallback returning job metadata and download URLs (requires `Authorization: Bearer <auth_token>` matching the job's assigned kiosk)
- `POST /api/jobs` — Multipart upload (`files`, `machine_id`, `copies`, `color`), PDF page count detection, cost calculation, Razorpay/Dev order creation
- `GET /api/jobs/:jobId/status` — Poll payment status & retrieve 6-digit OTP once paid
- `GET /api/jobs/:jobId/files/:fileId` — Kiosk-authenticated file download (`Authorization: Bearer <auth_token>` or `?token=<auth_token>`)
- `POST /api/webhooks/razorpay` — Razorpay webhook (`payment.captured` / `order.paid`) with `x-razorpay-signature` verification, 6-digit OTP generation, and WebSocket `job_dispatch`
- `POST /api/dev/jobs/:jobId/pay` — Dev/Test mode payment simulation (disabled when Razorpay keys are set)

## WebSocket Protocol (`/ws`)

### Machine Identity & Re-Registration Protocol

When a kiosk connects to `/ws`, it identifies itself using one of two messages based on token availability:

- **Register (`type: 'register'`)**:
  Sent when the kiosk has no active auth token (first launch, after resetting machine identity, or when re-registering).
  ```json
  {
    "type": "register",
    "machine_id": "kiosk_abcd",
    "pricing": { "bwPerPagePaise": 200, "colorPerPagePaise": 1000, "shopName": "Shop" },
    "supportedPaperSizes": ["A4", "A3"]
  }
  ```
  - **Deterministic `preferredMachineId` Preservation**: The relay preserves the kiosk's supplied `machine_id` rather than replacing it with a newly generated random ID.
  - Generates a fresh `authToken`, marks the kiosk online, registers supported paper sizes, sends back a `registered` message, and immediately flushes unacknowledged pending jobs.

- **Authenticate (`type: 'auth'`)**:
  Sent on normal connections when the kiosk has a saved `auth_token`.
  ```json
  {
    "type": "auth",
    "machine_id": "kiosk_abcd",
    "auth_token": "tok_...",
    "pricing": { "bwPerPagePaise": 200, "colorPerPagePaise": 1000 },
    "supportedPaperSizes": ["A4", "A3"]
  }
  ```
  - If valid, responds with `auth_ok` and flushes unacknowledged pending jobs.
  - If the kiosk sends `auth` without a token, the relay re-issues a new token and authenticates the kiosk without dropping machine identity.

### Offline Job Delivery & Acknowledgement Lifecycle

To ensure print jobs paid while the desktop app is closed or offline are never lost:

1. **Unacknowledged Job Flush on Connect/Reconnect**:
   When customer payment settles (via Razorpay webhook or dev pay) while a kiosk is disconnected, the job is generated with an OTP and held in the relay store. Upon kiosk connection (`register` or `auth`), the relay immediately calls `flushPendingJobs(machineId)`. This queries `getUnacknowledgedPaidJobs(machineId)`—retrieving all jobs in `paid` or `dispatched` state that have not yet been acknowledged (`job.acknowledged !== true`)—and dispatches them over `/ws`.
2. **Kiosk Acknowledgement (`job_ack`)**:
   Once the kiosk downloads all job files and commits the job record to local SQLite, it sends `{ "type": "job_ack", "job_id": "job_..." }` over WebSocket.
3. **Relay Acknowledgement Tracking**:
   Upon receiving `job_ack` (or terminal status updates such as `printing`, `printed`, `failed`, or `cancelled`), the relay marks `job.acknowledged = true` and `job.acknowledgedAt = Date.now()`, removing it from future pending flushes.

### Kiosk -> Relay Messages

- **Register**: `{ "type": "register", "machine_id"?: string, "pricing": { "bwPerPagePaise": 200, "colorPerPagePaise": 1000, "shopName": "My Shop" }, "supportedPaperSizes"?: string[] }`
- **Authenticate**: `{ "type": "auth", "machine_id": string, "auth_token"?: string, "pricing": { ... }, "supportedPaperSizes"?: string[] }`
- **Update Pricing**: `{ "type": "pricing_update", "bwPerPagePaise": 300, "colorPerPagePaise": 1200, "shopName": "My Shop" }`
- **Job Ack**: `{ "type": "job_ack", "job_id": "job_..." }`
- **Job Status Update**: `{ "type": "job_status_update", "job_id": "job_...", "status": "printing" | "printed" | "failed" | "cancelled", "error"?: string }`
- **Ping**: `{ "type": "ping" }`

### Relay -> Kiosk Messages

- **Registered**: `{ "type": "registered", "machine_id": "...", "auth_token": "...", "pricing": { ... }, "supportedPaperSizes": [...] }`
- **Auth OK**: `{ "type": "auth_ok", "machine_id": "...", "auth_token": "...", "pricing": { ... }, "supportedPaperSizes": [...] }`
- **Pricing Ack**: `{ "type": "pricing_ack", "pricing": { ... } }`
- **Job Dispatch**:
  ```json
  {
    "type": "job_dispatch",
    "job_id": "job_...",
    "otp": "482910",
    "amount_paise": 1200,
    "print_settings": { "copies": 2, "color": false },
    "files": [
      {
        "file_id": "file_...",
        "filename": "doc.pdf",
        "mime_type": "application/pdf",
        "size_bytes": 12345,
        "page_count": 3,
        "download_url": "http://localhost:3000/api/jobs/job_.../files/file_...",
        "settings": {
          "copies": 1,
          "color": false,
          "duplex": "1-sided",
          "orientation": "portrait",
          "pages_per_sheet": 1,
          "page_range": "all",
          "print_ready": true,
          "paper_size": "A4"
        }
      }
    ],
    "created_at": "2026-11-12T07:00:00.000Z"
  }
  ```
- **Pong**: `{ "type": "pong" }`
- **Error**: `{ "type": "error", "code": "...", "message": "..." }`
