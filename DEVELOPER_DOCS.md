# JetPrint Developer Documentation

Technical reference for the JetPrint system: Cloud Relay HTTP/WebSocket APIs, Tauri v2 Rust backend, React/TypeScript frontend, production deployment, and GitHub Actions release pipeline.

> See [`README.md`](README.md) for quick-start, [`OWNER_SETUP_GUIDE.md`](OWNER_SETUP_GUIDE.md) for shop-owner setup, and [`desktop-kiosk/src-tauri/UPDATER_SETUP.md`](desktop-kiosk/src-tauri/UPDATER_SETUP.md) for signing key setup.

## Table of Contents

- [1. System Architecture & Data Flow](#1-system-architecture--data-flow)
- [2. Cloud Relay (`cloud-relay/`)](#2-cloud-relay-cloud-relay)
  - [Environment Variables](#environment-variables-cloud-relayenvexample)
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
  │  3. Uploads PDF/Images -> POST /api/jobs (page count via pdf-lib, creates Razorpay order)
  │  4. Completes UPI payment -> Razorpay sends POST /api/webhooks/razorpay
  ▼
Cloud Relay (cloud-relay/)
  │  5. Verifies x-razorpay-signature (HMAC-SHA256), generates 6-digit OTP
  │  6. Pushes job_dispatch over WebSocket (/ws) to target machine_id
  ▼
Tauri v2 Desktop Kiosk (desktop-kiosk/src-tauri/)
  │  7. ws_client.rs downloads files via GET /api/jobs/:jobId/files/:fileId (Bearer token)
  │  8. Inserts job + OTP into local SQLite (jetprint.db -> print_jobs)
  │  9. Emits Tauri event "job-received" to React UI
  ▼
Kiosk UI & Printer (desktop-kiosk/src/ + printer.rs)
     10. Customer enters 6-digit OTP (Self-Service) or Owner clicks Print (Owner Mode)
     11. verify_otp_and_print -> printer::print_job_files() -> OS printer
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

### HTTP Endpoints (`cloud-relay/src/routes/api.ts` & `app.ts`)

| Method & Path | Purpose |
|---|---|
| `GET /upload?machine_id=<id>` | Serves the mobile upload & UPI checkout web app (`cloud-relay/public/`). |
| `GET /api/health` | Health check and current payment mode (`devMode`). |
| `GET /api/machines/:machineId` | Returns kiosk online status and synced pricing (`bwPerPagePaise`, `colorPerPagePaise`, `shopName`). |
| `POST /api/jobs` | Accepts multipart `files`, `machine_id`, `copies`, `color` (plus `per_file_settings`); detects PDF page counts; calculates amount in paise; creates Razorpay order (or dev order). |
| `GET /api/jobs/:jobId/status` | Polls job payment/print status; returns 6-digit `otp` once paid. |
| `GET /api/jobs/:jobId/files/:fileId` | Downloads an uploaded file. Requires `Authorization: Bearer <auth_token>` (or `?token=<auth_token>`). |
| `POST /api/webhooks/razorpay` | Verifies `x-razorpay-signature` for `payment.captured` / `order.paid`, generates 6-digit OTP, pushes `job_dispatch` via WebSocket. |
| `POST /api/dev/jobs/:jobId/pay` | Simulates payment when `devMode` is active (disabled when Razorpay keys are set). |

### WebSocket Protocol (`/ws`, `cloud-relay/src/ws.ts`)

**Kiosk → Relay:**
- `register`: `{ "type": "register", "machine_id"?: string, "pricing": { "bwPerPagePaise", "colorPerPagePaise", "shopName"? } }`
- `auth`: `{ "type": "auth", "machine_id": string, "auth_token"?: string, "pricing": { "bwPerPagePaise", "colorPerPagePaise" } }`
- `pricing_update`: `{ "type": "pricing_update", "bwPerPagePaise": number, "colorPerPagePaise": number, "shopName"?: string }`
- `job_ack`: `{ "type": "job_ack", "job_id": string }`
- `job_status_update`: `{ "type": "job_status_update", "job_id": string, "status": "printing" | "printed" | "failed", "error"?: string }`
- `ping`: `{ "type": "ping" }`

**Relay → Kiosk:**
- `registered` / `auth_ok`: `{ "type": "registered" | "auth_ok", "machine_id": string, "auth_token": string, "pricing": { ... } }`
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

- **`src/lib.rs`**: Initializes `tauri_plugin_updater`, `tauri_plugin_process`, opens SQLite at `<app_data_dir>/jetprint.db`, registers `AppState`, spawns `ws_client::spawn_relay_loop`, and registers all 9 Tauri commands.
- **`src/db.rs`**: SQLite persistence (`rusqlite`, WAL mode).
  - **`app_config`** (singleton row `id = 1`): `machine_id`, `relay_url`, `auth_token`, `password_hash`, `recovery_phrase_hash`, `bw_price_paise` (default `200`), `color_price_paise` (default `1000`), `default_printer`, `kiosk_mode` (`'self_service'` | `'owner'`), `setup_complete` (`0` | `1`).
  - **`print_jobs`**: `id` (PK), `otp` (indexed), `files_json`, `copies`, `color`, `status` (`pending` | `printing` | `printed` | `failed`), `created_at`, `printed_at`.
- **`src/security.rs`**:
  - `generate_recovery_phrase()`: 12-word BIP39 mnemonic (`bip39` crate).
  - `normalize_phrase()` / `validate_phrase()`: Lowercases, trims whitespace, validates 12-word BIP39.
  - `hash_secret()` / `verify_secret()`: Argon2id PHC hashing/verification (`argon2` crate).
- **`src/printer.rs`**: `list_system_printers()` / `print_job_files()` via the `printers` crate (`copies` and `ColorModel` raw properties).
- **`src/ws_client.rs`**:
  - `build_ws_url()`: Converts `http(s)://` to `ws(s)://.../ws`.
  - `spawn_relay_loop()`: Connects via `tokio-tungstenite`, sends `auth` (persisting returned `auth_token`), downloads `job_dispatch` files via `reqwest` (Bearer auth) into a temp dir, inserts job into SQLite, sends `job_ack`, emits `job-received` and `relay-status`.

### Tauri Commands (`src/commands.rs`) & Events

| Command | Arguments | Return Type |
|---|---|---|
| `get_kiosk_state` | — | `KioskState` |
| `complete_first_run` | `password: string` | `CompleteFirstRunResult` (`{ recoveryPhrase, state }`) |
| `verify_owner_password` | `password: string` | `boolean` |
| `reset_password_with_phrase` | `phrase: string, newPassword: string` | `void` |
| `update_settings` | `settings: UpdateSettingsInput` | `KioskState` |
| `list_printers` | — | `PrinterInfo[]` |
| `verify_otp_and_print` | `otp: string` | `PrintResult` (`{ job, message }`) |
| `list_jobs` | `limit?: number` | `PrintJob[]` |
| `connect_relay` | `relayUrl?: string` | `KioskState` |

**Emitted Events:**
- `job-received` (`PrintJob` payload) — fired when a paid job is downloaded and saved to SQLite.
- `relay-status` (`RelayStatusEvent`: `{ connected, machineId, message }`) — fired on WebSocket connect/disconnect/error.

---

## 4. React / TypeScript Frontend (`desktop-kiosk/src/`)

- **`src/api/tauri.ts`**: Typed wrappers around `invoke(...)`, `listen(...)` (`listenKioskEvents`), `check()` (`checkForAppUpdate`), and `downloadAndInstall()` + `relaunch()` (`installUpdateAndRelaunch`).
- **`src/types.ts`**: TypeScript interfaces matching `src-tauri/src/models.rs` (`camelCase`).
- **`src/App.tsx`**: Loads `KioskState`, checks for updates on startup, subscribes to `job-received` and `relay-status`, handles `Ctrl+Shift+S` / `Cmd+Shift+S` and 5-tap corner trigger, and renders:
  - `QrPanel.tsx`: QR code for `<relayUrl>/upload?machine_id=<machineId>` and pricing.
  - `OtpKeypad.tsx`: 6-digit touch/keyboard keypad (Self-Service mode).
  - `OwnerModeQueue.tsx`: Live job queue with **Print** buttons (Owner mode).
  - `FirstRunWizard.tsx`: First-run password creation & BIP39 phrase confirmation.
  - `OwnerSettingsModal.tsx`: Password login, BIP39 reset, updater banner, mode toggle, printer selector, pricing, relay URL.

---

## 5. GitHub Actions Release Pipeline & Auto-Updater

- **Config ([`desktop-kiosk/src-tauri/tauri.conf.json`](desktop-kiosk/src-tauri/tauri.conf.json))**:
  - `bundle.createUpdaterArtifacts: true`
  - `plugins.updater.endpoints`: `https://github.com/dharantej1/JetPrint/releases/latest/download/updater.json`
  - `plugins.updater.pubkey`: Replace with your generated public key (see [`UPDATER_SETUP.md`](desktop-kiosk/src-tauri/UPDATER_SETUP.md)).
- **Workflow ([`.github/workflows/release.yml`](.github/workflows/release.yml))**:
  - Triggers only on `v*` tags.
  - Matrix builds:
    - `macos-latest` (`aarch64-apple-darwin`, `x86_64-apple-darwin`)
    - `ubuntu-22.04` (x86_64 Linux `.deb` and `.AppImage`)
    - `ubuntu-22.04-arm` (native ARM64 Linux `.deb` and `.AppImage` targeting Raspberry Pi 4/5 and ARM64 single-board computers)
    - `windows-latest` (NSIS `.exe` and `.msi`)
  - Installs required Linux dependencies on both Ubuntu runners (`libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`, `libcups2-dev`).
  - Runs `Sync version from git tag` before building, then uses `tauri-apps/tauri-action@v0` with `GITHUB_TOKEN`, `TAURI_SIGNING_PRIVATE_KEY`, and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (`updaterJsonPreferNsis: true`).

### Automated Version Bump & Release

**Tag-Only Release Flow** — create and push a semver tag:
```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```
The `Sync version from git tag` step strips the leading `v`, validates `X.Y.Z`, and stamps it into `tauri.conf.json`, `package.json`, and `Cargo.toml` before `tauri-action` builds the installers and `updater.json`.

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
