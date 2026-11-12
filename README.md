# JetPrint

**JetPrint** is a self-service print kiosk system for print shops and campuses. Customers scan a QR code on the kiosk screen, upload PDF or image files from their phone, pay via Razorpay UPI, and enter a 6-digit OTP on the kiosk to print their documents.

## Table of Contents

- [Architecture Overview (4 Phases)](#architecture-overview-4-phases)
- [Directory Structure](#directory-structure)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
  - [1. Cloud Relay (`cloud-relay/`)](#1-cloud-relay-cloud-relay)
  - [2. Desktop Kiosk (`desktop-kiosk/`)](#2-desktop-kiosk-desktop-kiosk)
- [Documentation](#documentation)

## Architecture Overview (4 Phases)

1. **Phase 1 — Cloud Relay & Mobile Web UI ([`cloud-relay/`](cloud-relay/))**:
   - Node.js + TypeScript + Express + `ws` server.
   - Serves the mobile-responsive upload & UPI payment web app at `GET /upload?machine_id=<id>`.
   - Detects PDF page counts (`pdf-lib`), calculates total cost from the kiosk's synced B&W/Color per-page pricing, creates Razorpay orders (with a Dev/Test fallback when Razorpay keys are unset), verifies `POST /api/webhooks/razorpay` signatures, generates a 6-digit OTP, and dispatches the job to the target kiosk over WebSocket (`/ws`).
2. **Phase 2 — Tauri v2 Desktop Kiosk Backend ([`desktop-kiosk/src-tauri/`](desktop-kiosk/src-tauri/))**:
   - Rust backend using Tauri v2, `rusqlite` (SQLite), `argon2` + `bip39` (owner password & 12-word recovery phrase), `printers` (OS printer discovery & printing), `tokio-tungstenite` (WebSocket client), and `reqwest` (authenticated file downloads).
   - Persists configuration (`app_config`) and incoming print jobs (`print_jobs`) locally, and emits `job-received` and `relay-status` events to the frontend.
3. **Phase 3 — Kiosk UI ([`desktop-kiosk/src/`](desktop-kiosk/src/))**:
   - React 18 + TypeScript + Vite fullscreen kiosk interface.
   - Displays the dynamic QR code (`QrPanel`), 6-digit OTP keypad (`OtpKeypad`) in Self-Service Mode, print queue (`OwnerModeQueue`) in Owner Mode, first-run security wizard (`FirstRunWizard`), and password-protected `OwnerSettingsModal`.
4. **Phase 4 — Auto-Updater & Release CI ([`.github/workflows/release.yml`](.github/workflows/release.yml))**:
   - Configures `tauri-plugin-updater` and `tauri-plugin-process` with `createUpdaterArtifacts: true`.
   - GitHub Actions workflow builds signed macOS (`aarch64-apple-darwin`, `x86_64-apple-darwin`), Ubuntu 22.04, and Windows installers on `v*` tags and publishes `updater.json`.

## Directory Structure

```text
JetPrint/
├── .github/workflows/release.yml       # Cross-platform Tauri release & updater.json CI
├── cloud-relay/                        # Phase 1: Express + ws Cloud Relay & Mobile UI
│   ├── public/                         # Mobile upload & payment frontend
│   ├── src/                            # TypeScript server, routes, WS, Razorpay, PDF utils
│   ├── tests/relay.test.ts             # Vitest integration tests
│   └── .env.example                    # Cloud Relay environment template
├── desktop-kiosk/                      # Phases 2–4: Tauri v2 Desktop Kiosk
│   ├── src/                            # React + TypeScript kiosk UI
│   └── src-tauri/                      # Rust backend, SQLite, security, printer, WS client
│       ├── tauri.conf.json             # Tauri v2 & updater configuration
│       └── UPDATER_SETUP.md            # Signing keypair & GitHub Secrets instructions
├── OWNER_SETUP_GUIDE.md                # Non-technical shop-owner setup & operations guide
└── DEVELOPER_DOCS.md                   # Technical architecture, API, DB, and CI reference
```

## Prerequisites

- **Node.js 20+** and `npm` (used by `cloud-relay/` and `desktop-kiosk/`).
- **Rust & Cargo** (stable toolchain, required for `desktop-kiosk/src-tauri/`).
- **Tauri v2 OS dependencies**:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`).
  - **Windows**: Microsoft C++ Build Tools and WebView2.
  - **Linux (Ubuntu/Debian)**:
    ```bash
    sudo apt-get update
    sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libcups2-dev
    ```

## Quick Start

### 1. Cloud Relay (`cloud-relay/`)

```bash
cd cloud-relay
cp .env.example .env
npm install
npm run dev
```

- Runs on `http://localhost:3000` by default (`PORT=3000` in `.env`).
- Leave `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` blank in `.env` to run in Dev/Test payment simulation mode.
- Run tests: `npm test` (Vitest).

### 2. Desktop Kiosk (`desktop-kiosk/`)

```bash
cd desktop-kiosk
npm install
npm run dev          # Vite frontend only (http://localhost:5173)
npx tauri dev        # Full Tauri desktop app (Rust backend + React UI)
```

> **Note on local port:** Both `cloud-relay` (`PORT=3000` in `.env`) and `desktop-kiosk` (seeded `relay_url` = `http://localhost:3000` in SQLite) default to `http://localhost:3000`, so they connect automatically out of the box. For mobile QR-code testing on the same Wi-Fi, set **Cloud Relay URL** in **Owner Settings** (or during Step 3 of First-Run Setup) to your computer's LAN IP (e.g., `http://192.168.1.50:3000`), or use a public `https://` URL for production.

- On first launch, the **3-step First-Run Setup Wizard** guides you through setting an Owner Password, saving your 12-word recovery phrase, and configuring your printer, pricing, and Cloud Relay URL. If existing JetPrint data is detected on a reinstall, a prompt lets you choose **Keep Previous Data** or **Start Fresh**.
- Run Rust backend tests: `cd desktop-kiosk/src-tauri && cargo test`
- Build frontend bundle: `cd desktop-kiosk && npm run build`

## Documentation

- **[Owner Setup Guide](OWNER_SETUP_GUIDE.md)** — Step-by-step instructions for shop owners (OS installation, first-run setup, 12-word recovery phrase, pricing, printer selection, modes, password reset, updates, and troubleshooting).
- **[Developer Documentation](DEVELOPER_DOCS.md)** — Full technical reference for APIs, WebSocket messages, SQLite schema, Tauri commands/events, production deployment, and CI/CD.
- **[Tauri Auto-Updater Setup](desktop-kiosk/src-tauri/UPDATER_SETUP.md)** — Signing keypair generation and GitHub Actions secret configuration.
