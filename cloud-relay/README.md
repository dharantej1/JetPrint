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

## HTTP Endpoints

- `GET /upload?machine_id=<id>` — Mobile-responsive upload & UPI payment UI
- `GET /api/health` — Health & mode check
- `GET /api/machines/:machineId` — Kiosk online status & pricing (`bwPerPagePaise`, `colorPerPagePaise`, `shopName`)
- `POST /api/jobs` — Multipart upload (`files`, `machine_id`, `copies`, `color`), PDF page count detection, cost calculation, Razorpay/Dev order creation
- `GET /api/jobs/:jobId/status` — Poll payment status & retrieve 6-digit OTP once paid
- `GET /api/jobs/:jobId/files/:fileId` — Kiosk-authenticated file download (`Authorization: Bearer <auth_token>` or `?token=<auth_token>`)
- `POST /api/webhooks/razorpay` — Razorpay webhook (`payment.captured` / `order.paid`) with `x-razorpay-signature` verification, 6-digit OTP generation, and WebSocket `job_dispatch`
- `POST /api/dev/jobs/:jobId/pay` — Dev/Test mode payment simulation (disabled when Razorpay keys are set)

## WebSocket Protocol (`/ws`)

### Kiosk -> Relay

- **Register**: `{ "type": "register", "machine_id": "optional", "pricing": { "bwPerPagePaise": 200, "colorPerPagePaise": 1000, "shopName": "My Shop" } }`
- **Authenticate**: `{ "type": "auth", "machine_id": "...", "auth_token": "...", "pricing": { ... } }`
- **Update Pricing**: `{ "type": "pricing_update", "bwPerPagePaise": 300, "colorPerPagePaise": 1200, "shopName": "My Shop" }`
- **Job Ack**: `{ "type": "job_ack", "job_id": "..." }`
- **Ping**: `{ "type": "ping" }`

### Relay -> Kiosk

- **Registered**: `{ "type": "registered", "machine_id": "...", "auth_token": "...", "pricing": { ... } }`
- **Auth OK**: `{ "type": "auth_ok", "machine_id": "...", "auth_token": "...", "pricing": { ... } }`
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
        "download_url": "http://localhost:3000/api/jobs/job_.../files/file_..."
      }
    ],
    "created_at": "2026-11-12T07:00:00.000Z"
  }
  ```
- **Pong**: `{ "type": "pong" }`
- **Error**: `{ "type": "error", "code": "...", "message": "..." }`
