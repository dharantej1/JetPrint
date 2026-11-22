# JetPrint Developer Documentation

Technical reference for the JetPrint system: Cloud Relay HTTP/WebSocket APIs, Tauri v2 Rust backend, React/TypeScript frontend, production deployment, and GitHub Actions release pipeline.

> See [`README.md`](README.md) for quick-start, [`OWNER_SETUP_GUIDE.md`](OWNER_SETUP_GUIDE.md) for shop-owner setup, and [`desktop-kiosk/src-tauri/UPDATER_SETUP.md`](desktop-kiosk/src-tauri/UPDATER_SETUP.md) for signing key setup.

## Table of Contents

- [1. System Architecture & Data Flow](#1-system-architecture--data-flow)
- [2. Cloud Relay (`cloud-relay/`)](#2-cloud-relay-cloud-relay)
  - [Environment Variables](#environment-variables-cloud-relayenvexample)
  - [Orientation Fidelity & Document Pre-Flight](#orientation-fidelity--document-pre-flight-srcpdfts--publicappjs)
  - [HTTP Endpoints](#http-endpoints-cloud-relaysrcroutesapits--appts)
  - [WebSocket Protocol](#websocket-protocol-ws-cloud-relaysrcwsts)
- [3. Tauri v2 Rust Backend (`desktop-kiosk/src-tauri/`)](#3-tauri-v2-rust-backend-desktop-kiosksrc-tauri)
  - [Modules](#modules)
  - [Tauri Commands & Events](#tauri-commands-srccommandsrs--events)
- [4. React / TypeScript Frontend (`desktop-kiosk/src/`)](#4-react--typescript-frontend-desktop-kiosksrc)
- [5. GitHub Actions Release Pipeline & Auto-Updater](#5-github-actions-release-pipeline--auto-updater)
- [6. Production Deployment & Shop Onboarding](#6-production-deployment--shop-onboarding)
- [7. Local Development & Testing Commands](#7-local-development--testing-commands)

---

## 1. System Architecture & Data Flow

```text
Customer Mobile Browser
  │  1. Scans QR -> GET /upload?machine_id=<id>
  │  2. Fetches pricing -> GET /api/machines/:machineId
  │  3. Uploads PDF/Images -> POST /api/jobs (EXIF auto-rotation, PDF normalization, creates Razorpay order)
  │  4. Completes UPI payment -> Razorpay sends POST /api/webhooks/razorpay
  ▼
Cloud Relay (cloud-relay/)
  │  5. Verifies x-razorpay-signature (HMAC-SHA256), generates 6-digit OTP
  │  6. Dispatches job over WebSocket (/ws); if kiosk is offline, job stays queued as unacknowledged
  ▼
Tauri v2 Desktop Kiosk (desktop-kiosk/src-tauri/)
  │  7. ws_client.rs receives job_dispatch (or flushes unacknowledged jobs on connect/reconnect)
  │  8. Downloads files via GET /api/jobs/:jobId/files/:fileId with 3-attempt progressive backoff
  │  9. Inserts job + OTP into local SQLite (jetprint.db -> print_jobs), emits "job-received", and sends job_ack
  │  10. Background sync: polls GET /api/machines/:machineId/active-jobs on connect and queue refresh
  ▼
Kiosk UI & Print Engines (desktop-kiosk/src/ + printer.rs + macos_print.m)
     11. Self-Service OTP keypad (with on-demand GET /api/jobs/by-otp/:otp fallback) OR Owner Mode Queue
     12. Dispatches to native macOS PDFKit (Apple) or sanitized CUPS / WinSpool spooler
```

---

## 2. Cloud Relay (`cloud-relay/`)

### Environment Variables (`cloud-relay/.env.example`)

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP & WebSocket server port | `3000` |
| `PUBLIC_URL` | Base URL for `download_url` (auto-detected from `Host` if empty) | `""` |
| `RAZORPAY_KEY_ID` | Razorpay Key ID (unset = Dev/Test fallback mode) | `""` |
| `RAZORPAY_KEY_SECRET` | Razorpay Key Secret | `""` |
| `RAZORPAY_WEBHOOK_SECRET` | HMAC-SHA256 secret for `POST /api/webhooks/razorpay` | `dev_webhook_secret` |
| `DEFAULT_BW_PRICE_PAISE` | Fallback B&W price per page in paise | `200` |
| `DEFAULT_COLOR_PRICE_PAISE` | Fallback Color price per page in paise | `1000` |
| `UPLOAD_DIR` | Temporary upload directory | `./uploads` |
| `FILE_TTL_MS` | File retention TTL in milliseconds | `3600000` |

### Orientation Fidelity & Document Pre-Flight (`src/pdf.ts` & `public/app.js`)

- **`getJpegExifOrientation(buffer)`**: Binary parser for JPEG APP1 markers extracting EXIF Tag `0x0112` (Orientation).
- **`exifOrientationToDegrees(orientation)`**: Converts EXIF tags (3 -> 180°, 6 -> 270° in PDF coordinates, 8 -> 90°) to compensate for camera rotation.
- **`checkPdfNeedsNormalization(buffer, mime, name, settings)`**: Detects whether a document contains non-standard page rotations, landscape viewports, or custom sheet sizes.
- **`buildPrintReadyPdf(buffer, mime, name, settings)`**: Pre-rotates pages and embeds raster images into a normalized PDF document with standardized media boxes, marked with `print_ready: true`.

### HTTP Endpoints (`cloud-relay/src/routes/api.ts` & `app.ts`)

| Method & Path | Purpose |
|---|---|
| `GET /upload?machine_id=<id>` | Serves the mobile upload & UPI checkout web app (`cloud-relay/public/`). |
| `GET /api/health` | Health check and current payment mode (`devMode`). |
| `GET /api/machines/:machineId` | Returns kiosk online status and synced pricing (`bwPerPagePaise`, `colorPerPagePaise`, `shopName`, `supportedPaperSizes`). |
| `GET /api/machines/:machineId/active-jobs` | Returns active unprinted jobs for kiosk synchronization. Requires `Authorization: Bearer <auth_token>` (or `?token=<auth_token>`). |
| `GET /api/jobs/by-otp/:otp` | On-demand OTP lookup fallback returning full job payload and file download URLs. Requires kiosk `Authorization: Bearer <auth_token>` matching the target machine. |
| `POST /api/jobs` | Accepts multipart `files`, `machine_id`, `copies`, `color` (plus `per_file_settings`); detects PDF page counts; calculates amount in paise; creates Razorpay order (or dev order). |
| `GET /api/jobs/:jobId/status` | Polls job payment/print status; returns 6-digit `otp` once paid. |
| `GET /api/jobs/:jobId/files/:fileId` | Downloads an uploaded file. Requires `Authorization: Bearer <auth_token>` (or `?token=<auth_token>`). |
| `POST /api/webhooks/razorpay` | Verifies `x-razorpay-signature` for `payment.captured` / `order.paid`, generates 6-digit OTP, pushes `job_dispatch` via WebSocket. |
| `POST /api/dev/jobs/:jobId/pay` | Simulates payment when `devMode` is active (disabled when Razorpay keys are set). |

### WebSocket Protocol (`/ws`, `cloud-relay/src/ws.ts`)

#### Machine Identity & Re-Registration Protocol

When a kiosk connects to `/ws`, it establishes its identity using either a registration or authentication handshake:

- **Registration (`type: 'register'`)**:
  Sent when the kiosk lacks an active authentication token (e.g., initial startup, factory reset, or after `reset_machine_identity`).
  - **Deterministic `preferredMachineId` Preservation**: If the kiosk transmits a `machine_id` (the client's hardware/persisted identity), the relay honors and preserves it rather than assigning a random machine ID.
  - The relay generates a new `authToken`, stores the pricing and paper size capabilities, marks the machine online, responds with `registered`, and immediately initiates an unacknowledged job flush.
- **Authentication (`type: 'auth'`)**:
  Sent during standard reconnects when the kiosk has a persisted `auth_token`.
  - The relay verifies the token against its registry. If valid, it responds with `auth_ok` and flushes any pending unacknowledged jobs.
  - If a kiosk reconnects with a blank or invalid token, the relay re-issues credentials under the preferred machine ID without dropping kiosk identity.
- **Clearing Stale Auth Errors**:
  During reconnection attempts (in `RelayHandle::request_reconnect` and `set_status`), any previously recorded auth errors (`guard.2`) are explicitly cleared (`None`), ensuring UI badges immediately reflect the active retry state rather than remaining stuck on stale error notices.

#### Offline Job Delivery & Acknowledgement Lifecycle

To guarantee that jobs paid while the desktop app is closed, suspended, or offline are never lost:

1. **Unacknowledged Job Flush on Connect/Reconnect**:
   When customer payment is confirmed via Razorpay webhook or dev pay while a kiosk is offline, the relay generates the 6-digit OTP and holds the job in memory. When the kiosk connects (via either `register` or `auth`), the relay immediately invokes `flushPendingJobs(machineId)`. This queries `getUnacknowledgedPaidJobs(machineId)` to retrieve all paid/dispatched jobs that have not yet been acknowledged (`job.acknowledged !== true`), dispatching them in chronological order.
2. **Kiosk Delivery Acknowledgement (`job_ack`)**:
   Once the desktop kiosk successfully downloads all job files to local disk and commits the job record to SQLite, it transmits a `job_ack` message over the WebSocket: `{ "type": "job_ack", "job_id": "..." }`.
3. **Relay Acknowledgement State**:
   Upon receiving `job_ack` (or a terminal `job_status_update` of `printing`, `printed`, `failed`, or `cancelled`), the relay marks the job as acknowledged (`job.acknowledged = true`, `job.acknowledgedAt = Date.now()`), removing it from subsequent reconnection flushes.

**Kiosk → Relay Messages:**
- `register`: `{ "type": "register", "machine_id"?: string, "pricing": { "bwPerPagePaise", "colorPerPagePaise", "shopName"? }, "supportedPaperSizes"?: string[] }`
- `auth`: `{ "type": "auth", "machine_id": string, "auth_token"?: string, "pricing": { "bwPerPagePaise", "colorPerPagePaise" }, "supportedPaperSizes"?: string[] }`
- `pricing_update`: `{ "type": "pricing_update", "bwPerPagePaise": number, "colorPerPagePaise": number, "shopName"?: string }`
- `job_ack`: `{ "type": "job_ack", "job_id": string }`
- `job_status_update`: `{ "type": "job_status_update", "job_id": string, "status": "printing" | "printed" | "failed" | "cancelled", "error"?: string }`
- `ping`: `{ "type": "ping" }`

**Relay → Kiosk Messages:**
- `registered` / `auth_ok`: `{ "type": "registered" | "auth_ok", "machine_id": string, "auth_token": string, "pricing": { ... }, "supportedPaperSizes": [...] }`
- `pricing_ack`: `{ "type": "pricing_ack", "pricing": { ... } }`
- `job_dispatch`:
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
        "download_url": "https://relay.example.com/api/jobs/job_.../files/file_..."
      }
    ],
    "created_at": "2026-11-12T07:00:00.000Z"
  }
  ```
- `pong`: `{ "type": "pong" }`
- `error`: `{ "type": "error", "code"?: string, "message": string }`

---

## 3. Tauri v2 Rust Backend (`desktop-kiosk/src-tauri/`)

### Modules

- **`src/lib.rs`**: Initializes `tauri_plugin_updater`, `tauri_plugin_process`, and `tauri_plugin_dialog`. Sets up `SharedStorage` defaulting to `~/Documents/JetPrint KIOSK` (with auto-migration from legacy app data), background 48-hour expired job cleanup task, manages `AppState`, spawns `ws_client::spawn_relay_loop`, and registers all 24 Tauri commands.
- **`src/storage.rs`**: Dedicated kiosk storage and file lifecycle management:
  - Default directory `~/Documents/JetPrint KIOSK` (or OS Documents directory) housing `jetprint.db`, downloaded print files in `jobs/`, and rolling diagnostics in `logs/jetprint.log`.
  - Automatic migration from legacy system app data directories on upgrade.
  - Background task running hourly to delete printed or cancelled job files older than 48 hours.
  - Custom storage folder selection with live disk usage calculation.
- **`src/logger.rs`**: Rotating application file logger writing to `logs/jetprint.log` with support for frontend retrieval and clearing.
- **`src/db.rs`**: SQLite persistence (`rusqlite`, WAL mode).
  - **`app_config`** (singleton row `id = 1`): `machine_id`, `relay_url`, `auth_token`, `password_hash`, `recovery_phrase_hash`, `bw_price_paise` (default `200`), `color_price_paise` (default `1000`), `default_printer`, `kiosk_mode` (`'self_service'` | `'owner'`), `rush_mode` (`0` | `1`), `setup_complete` (`0` | `1`).
  - **`configured_printers`**: `name` (PK), `nickname`, `pool` (`bw` | `color` | `large_format` | `default`), `capabilities` (JSON), `is_enabled` (0/1), `priority` (integer).
  - **`print_jobs`**: `id` (PK), `otp` (indexed), `files_json`, `copies`, `color`, `status` (`pending` | `printing` | `printed` | `failed`), `created_at`, `printed_at`.
- **`src/security.rs`**:
  - `generate_recovery_phrase()`: 12-word BIP39 mnemonic (`bip39` crate).
  - `normalize_phrase()` / `validate_phrase()`: Lowercases, trims whitespace, validates 12-word BIP39.
  - `hash_secret()` / `verify_secret()`: Argon2id PHC hashing/verification (`argon2` crate).
- **`src/macos_print.m`**: Native macOS PDFKit printing integration (`macos_print_pdf`):
  - Bridges Objective-C Cocoa APIs to Rust `extern "C"`.
  - Instantiates `PDFDocument` from file path and generates `NSPrintOperation`.
  - Configures `kPDFPrintPageScaleToFit` with `autoRotate: NO` (since pages are pre-normalized), completely eliminating printer manual feed tray prompts and orientation distortions on macOS.
- **`src/printer.rs`**:
  - `is_pdf_file()`: Inspects file extension, MIME type, `print_ready` setting, and `%PDF` magic bytes to route converted images and documents to native PDFKit or CUPS.
  - `build_file_print_properties()`: Assembles sanitized CUPS options (`fit-to-page`, `orientation-requested: 3`, `media-source: auto`) while preventing duplicate `landscape` tags for pre-composed print-ready documents.
  - `list_system_printers()`: Enumerates system printers via the `printers` crate, performs canonical name matching, resolves Bonjour ghost loopback aliases (`<PrinterName> @ <Host>`), and deduplicates network loopback entries.
  - `resolve_printer_with_alias_handling()`: Intelligent alias resolution matching requested printer names against canonical hardware queues or network aliases, with automatic fallback to the OS default printer.
  - `route_file_to_printer()`: Smart capability routing matching document properties (Color/BW, A4/A3/Legal) to pool queues with round-robin load balancing and fallback cascade.
  - `print_job_files_pooled()`: Dispatches each file in a job to its resolved printer with fallback handling.
  - `print_test_page()`: Sends an aligned diagnostic test page to any selected printer.
- **`src/ws_client.rs`**:
  - `build_ws_url()`: Converts `http(s)://` to `ws(s)://.../ws`.
  - `spawn_relay_loop()`: Connects via `tokio-tungstenite`. Inspects `auth_token`: sends `Auth` if token exists, or `Register` with client-persisted `machine_id` (`preferredMachineId`) if token is absent.
  - **Clearing Stale Auth Errors**: Clears previously captured connection error states on every reconnect attempt (`guard.2 = None`).
  - **Download Retry Backoff (`download_and_save_job`)**: Downloads each file via `reqwest` with Bearer auth, using up to 3 attempts with progressive linear backoff (500ms * attempt delay).
  - **Job Acknowledgement**: Sends `job_ack` over WebSocket upon successful local persistence, emits `job-received` to the UI, and updates `relay-status`.
  - **Active Jobs Background Sync (`sync_active_jobs`)**: Spawns automatically upon authentication to reconcile and download unprinted orders from `GET /api/machines/:machineId/active-jobs`.
- **`src/commands.rs`**: Implements all Tauri IPC invocations:
  - `verify_otp_and_print`: Validates OTP against local SQLite; if not found locally, falls back to querying Cloud Relay (`GET /api/jobs/by-otp/:otp`), downloads files with retry backoff, saves the job, returns `job_ack`, and proceeds with printing.
  - `sync_active_jobs`: Reconciles active unprinted jobs from Cloud Relay into local SQLite.

### Tauri Commands (`src/commands.rs`) & Events

| Command | Category | Arguments | Return Type | Description |
|---|---|---|---|---|
| `get_kiosk_state` | State | — | `KioskState` | Returns active kiosk settings, connection status, and storage path. |
| `complete_first_run` | Setup | `password: string` | `CompleteFirstRunResult` | Hashes owner password, creates BIP39 phrase, and finalizes setup. |
| `verify_owner_password` | Auth | `password: string` | `boolean` | Verifies Argon2id password hash for Owner Settings. |
| `reset_password_with_phrase` | Auth | `phrase: string, newPassword: string` | `void` | Validates BIP39 recovery phrase and updates owner password. |
| `update_settings` | Settings | `settings: UpdateSettingsInput` | `KioskState` | Updates printer, pricing, kiosk mode, and reconnects relay. |
| `reset_machine_identity` | Settings | — | `KioskState` | Clears auth token while preserving machine identity for relay re-registration. |
| `keep_existing_data` | Storage | — | `KioskState` | Dismisses existing data prompt and continues with saved DB. |
| `reset_installation_data` | Storage | — | `KioskState` | Deletes local database, clears credentials, and re-triggers setup. |
| `pick_storage_folder` | Storage | — | `string \| null` | Native OS folder picker to choose custom storage directory. |
| `set_storage_path` | Storage | `path: string` | `KioskState` | Moves database, jobs, and logs to selected storage folder. |
| `get_logs` | Logs | `lines?: number` | `string[]` | Reads recent entries from `logs/jetprint.log`. |
| `clear_logs` | Logs | — | `void` | Clears diagnostic log file contents. |
| `open_logs_window` | Logs | — | `void` | Opens standalone Tauri window to monitor live logs. |
| `list_printers` | Printer | — | `PrinterInfo[]` | Enumerates available OS printers (CUPS / spooler). |
| `get_configured_printers` | Printer | — | `ConfiguredPrinter[]` | Loads configured printers, pool assignments, and capability tags. |
| `save_configured_printers` | Printer | `printers: ConfiguredPrinter[]` | `void` | Persists printer pool configurations, nicknames, and active flags. |
| `test_print` | Printer | `printerName: string` | `void` | Async command (`spawn_blocking`, 30s timeout) to print an alignment test page on target printer. |
| `verify_otp_and_print` | Print | `otp: string` | `PrintResult` | Async command validating OTP (local DB + on-demand Cloud Relay fallback with download retry backoff) and dispatching job files. |
| `print_job_direct` | Print | `jobId: string, printerOverrides?: Record<string, string>` | `PrintResult` | Async direct print (`spawn_blocking`, 30s timeout) without OTP (used in Owner Queue & Rush Hour). |
| `sync_active_jobs` | Sync | — | `number` | Synchronizes active unprinted jobs from Cloud Relay (`GET /api/machines/:machineId/active-jobs`) into local SQLite. |
| `list_jobs` | Print | `limit?: number, date?: string` | `PrintJob[]` | Queries job history from local SQLite database. |
| `cancel_job` | Print | `jobId: string` | `void` | Marks pending job as failed/cancelled. |
| `connect_relay` | Relay | `relayUrl?: string` | `KioskState` | Updates relay address and forces WebSocket reconnection. |
| `is_fullscreen` | Window | — | `boolean` | Queries current window fullscreen state. |
| `toggle_fullscreen` | Window | — | `boolean` | Toggles between windowed and fullscreen display. |
| `set_fullscreen` | Window | `fullscreen: boolean` | `void` | Sets fullscreen mode explicitly. |
| `check_for_updates` | Updater | — | `UpdateCheckResult` | Resilient dual-path update check (GitHub API + Fastly CDN fallback). |
| `install_update` | Updater | — | `void` | Downloads, Minisign-verifies, installs update, and restarts kiosk. |

**Emitted Events:**
- `job-received` (`PrintJob` payload) — fired when a paid job is downloaded and saved to SQLite.
- `relay-status` (`RelayStatusEvent`: `{ connected, machineId, message }`) — fired on WebSocket connect/disconnect/error.

---

## 4. React / TypeScript Frontend (`desktop-kiosk/src/`)

- **`src/api/tauri.ts`**: Typed wrappers around all Tauri commands (including printer pooling, direct print, and `syncActiveJobs`), event listeners (`listenKioskEvents`), window controls (`toggleFullscreen`, `setFullscreen`), and update helpers (`checkForAppUpdate`, `installUpdateAndRelaunch`).
- **`src/types.ts`**: TypeScript interfaces matching `src-tauri/src/models.rs` (`camelCase`), including `ConfiguredPrinter`, `PrinterPoolType`, and `PrinterPoolConfig`.
- **`src/App.tsx`**: Loads `KioskState`, runs silent background update check on mount, listens for `job-received` and `relay-status`, handles `Ctrl+Shift+S` / `Cmd+Shift+S` and 5-tap corner trigger, handles `F11` (toggle fullscreen) and `Escape` (exit fullscreen), triggers `syncActiveJobs()` on reconnect or state refresh when in Owner Mode, and coordinates the **Rush Hour Auto-Print Engine**:
  - `printQueueRef`: Sequential First-In, First-Out (FIFO) queue for auto-print jobs.
  - `isProcessingQueueRef`: Concurrency lock ensuring single-threaded spooler dispatch to prevent driver collisions.
  - `enqueueJobForPrint()`: Enqueues incoming paid jobs and triggers sequential execution.
  - **Pending Job Recovery Sweep**: Sweeps SQLite on Rush Hour toggle and initial state load for `pending` jobs, recovering unprinted jobs after offline or idle periods.
  - Renders:
  - `QrPanel.tsx`: QR code for `<relayUrl>/upload?machine_id=<machineId>` and pricing.
  - `OtpKeypad.tsx`: 6-digit touch/keyboard keypad (Self-Service mode) with on-demand cloud relay lookup fallback.
  - `OwnerModeQueue.tsx`: High-throughput queue with 4 workflow tabs (`Action Needed`, `Completed`, `Printed`, `All Jobs`), real-time search filtering (`Quick search OTP or file...`), 10px touch-friendly scrollbar, fluid responsive grid, 10s auto-dismissing banner notice, per-file printer overrides (`printerOverrides`), Refresh button with spin indicator that triggers `syncActiveJobs()`, and removed reprint button for purged documents.
  - `FirstRunWizard.tsx`: First-run password creation & BIP39 phrase confirmation.
  - `OwnerUnlockModal.tsx`: Keypad PIN/Password authentication dialog before entering settings.
  - `DedicatedSettingsPage.tsx`: Full-page settings workspace with Master-Detail printer & pool assignments, interactive pool filter tabs, per-page pricing, mode selection, relay status, and system controls.
  - `LogsWindow.tsx`: Dedicated live logs inspector.

---

## 5. GitHub Actions Release Pipeline & Auto-Updater

- **Config ([`desktop-kiosk/src-tauri/tauri.conf.json`](desktop-kiosk/src-tauri/tauri.conf.json))**:
  - `app.windows`: Windowed by default (`fullscreen: false`, `center: true`, `resizable: true`).
  - `bundle.createUpdaterArtifacts: true`
  - `plugins.updater.endpoints`: `https://github.com/dharantej1/JetPrint/releases/latest/download/latest.json`
  - `plugins.updater.pubkey`: Cryptographic Minisign public key (see [`UPDATER_SETUP.md`](desktop-kiosk/src-tauri/UPDATER_SETUP.md)).
- **Workflow ([`.github/workflows/release.yml`](.github/workflows/release.yml))**:
  - Triggers only on `v*` tags.
  - Matrix builds across 5 runner targets:
    - `macos-latest` (`aarch64-apple-darwin` — Apple Silicon M1–M4)
    - `macos-latest` (`x86_64-apple-darwin` — Intel Mac)
    - `ubuntu-22.04` (x86_64 Linux `.deb` and `.AppImage`)
    - `ubuntu-22.04-arm` (native ARM64 Linux `.deb` and `.AppImage` for Raspberry Pi 4/5 & ARM64 SBCs)
    - `windows-latest` (x86_64 NSIS `.exe` and `.msi`)
  - Linux dependency installation: Installs `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`, `libcups2-dev` on all Linux runners (`runner.os == 'Linux'`).
  - Multi-Platform Matrix Updater Consolidation (`consolidate-updater` job):
    - Solves the GitHub Actions matrix upload race condition where parallel builder jobs overwrite each other's updater manifest.
    - Runs `.github/scripts/consolidate-latest-json.js` after all builder jobs complete.
    - Inspects release assets and generates a single unified `latest.json` manifest mapping **15 platform targets**:
      - `darwin-aarch64`, `darwin-aarch64-app`
      - `darwin-x86_64`, `darwin-x86_64-app`
      - `windows-x86_64`, `windows-x86_64-nsis`
      - `windows-x86_64-msi`
      - `linux-x86_64`, `linux-x86_64-appimage`
      - `linux-x86_64-deb`
      - `linux-x86_64-rpm`
      - `linux-aarch64`, `linux-aarch64-appimage` (Raspberry Pi ARM64)
      - `linux-aarch64-deb` (Raspberry Pi ARM64)
      - `linux-aarch64-rpm` (Raspberry Pi ARM64)
  - Resilient In-App Update Engine:
    - `check_for_updates`: Uses dual-path resolution: attempts manifest check with a 2.5-second connect timeout and no-proxy configuration, falling back immediately to the direct GitHub Releases API (`api.github.com/repos/.../releases/latest`) to bypass CDN cold-start latencies.
    - `install_update`: Downloads target binary, verifies Minisign signature, installs package, and cleanly relaunches JetPrint via `app.restart()`.

### Automated Version Bump & Release

**Tag-Only Release Flow** — create and push a semver tag:
```bash
git tag vX.Y.Z
git push origin main && git push origin vX.Y.Z
```
The `Sync version from git tag` step strips the leading `v`, validates `X.Y.Z`, and stamps it into `tauri.conf.json`, `package.json`, and `Cargo.toml`. `tauri-action` builds the platform installers, and `consolidate-updater` publishes the unified `latest.json`.

---

## 6. Production Deployment & Shop Onboarding

### Hosting `cloud-relay/`

`cloud-relay/` **must** be deployed on a **persistent Node.js host with WebSocket support** — such as **Render**, **Railway**, **Fly.io**, or a **VPS** (DigitalOcean, AWS EC2, Hetzner).

> **Why not Vercel / serverless?** Stateless platforms cannot maintain persistent WebSocket connections (`/ws`) or store temporary files (`UPLOAD_DIR`) across requests.

#### Recommended Deployment Settings

| Setting | Value |
|---|---|
| **Root Directory** | `cloud-relay` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Required Env Vars** | `PUBLIC_URL=https://<your-relay-domain>`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |

#### Razorpay Webhook Setup

In **Razorpay Dashboard → Settings → Webhooks**, add:
- **Webhook URL**: `https://<your-relay-domain>/api/webhooks/razorpay`
- **Secret**: Same value as `RAZORPAY_WEBHOOK_SECRET` in your Cloud Relay env.
- **Active Events**: `payment.captured` (and optionally `order.paid`).

### Delivering & Onboarding a Shop Owner

1. **Generate Updater Signing Keypair**: `npx tauri signer generate -w ~/.tauri/jetprint.key` and place the public key in `tauri.conf.json` (`plugins.updater.pubkey`).
2. **Configure GitHub Secrets**: Add `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in **Settings → Secrets and variables → Actions**.
3. **Build Release Installers**: Push a version tag (`git tag v0.1.0 && git push origin v0.1.0`) to trigger the workflow and publish installers + `updater.json`.
4. **Onboard the Shop**: Share the OS-specific installer and [`OWNER_SETUP_GUIDE.md`](OWNER_SETUP_GUIDE.md) with the shop's public `https://` Cloud Relay URL.

---

## 7. Local Development & Testing Commands

```bash
# Cloud Relay: typecheck, test, run
cd cloud-relay
npx tsc --noEmit
npm test
npm run dev

# Desktop Kiosk Frontend: typecheck & build
cd desktop-kiosk
npx tsc --noEmit
npm run build

# Desktop Kiosk Rust Backend: check & test
cd desktop-kiosk/src-tauri
cargo check
cargo test

# Full Desktop App (dev mode)
cd desktop-kiosk
npx tauri dev
```
