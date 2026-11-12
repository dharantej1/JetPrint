# JetPrint

**JetPrint** is a self-service print kiosk system for print shops and campuses. Customers scan a QR code, upload PDF or image files from their phone, pay via Razorpay UPI, and enter a 6-digit OTP on the kiosk to print.

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
   - Serves the mobile upload & UPI payment web app at `GET /upload?machine_id=<id>`.
   - Counts PDF pages (`pdf-lib`), calculates cost from synced pricing, creates Razorpay orders (Dev/Test fallback when keys are unset), verifies webhook signatures, generates a 6-digit OTP, and dispatches the job to the kiosk over WebSocket (`/ws`).
2. **Phase 2 — Tauri v2 Desktop Kiosk Backend ([`desktop-kiosk/src-tauri/`](desktop-kiosk/src-tauri/))**:
   - Rust backend: Tauri v2, `rusqlite` (SQLite), `argon2` + `bip39` (password & recovery phrase), `printers` (OS printing), `tokio-tungstenite` (WebSocket), `reqwest` (file downloads).
   - Persists config (`app_config`) and print jobs (`print_jobs`) locally; emits `job-received` and `relay-status` events to the frontend.
3. **Phase 3 — Kiosk UI ([`desktop-kiosk/src/`](desktop-kiosk/src/))**:
   - React 18 + TypeScript + Vite fullscreen kiosk interface.
   - Components: `QrPanel`, `OtpKeypad` (Self-Service Mode), `OwnerModeQueue` (Owner Mode), `FirstRunWizard`, `OwnerSettingsModal`.
4. **Phase 4 — Auto-Updater & Release CI ([`.github/workflows/release.yml`](.github/workflows/release.yml))**:
   - Uses `tauri-plugin-updater` and `tauri-plugin-process` with `createUpdaterArtifacts: true`.
   - GitHub Actions builds signed macOS (`aarch64`, `x86_64`), Ubuntu 22.04, and Windows installers on `v*` tags and publishes `updater.json`.

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

- **Node.js 20+** and `npm` (for `cloud-relay/` and `desktop-kiosk/`).
- **Rust & Cargo** (stable toolchain, for `desktop-kiosk/src-tauri/`).
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

- Runs on `http://localhost:3000` by default.
- Leave `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` blank to use Dev/Test payment simulation.
- Run tests: `npm test` (Vitest).

### 2. Desktop Kiosk (`desktop-kiosk/`)

```bash
cd desktop-kiosk
npm install
npm run dev          # Vite frontend only (http://localhost:5173)
npx tauri dev        # Full Tauri app (Rust backend + React UI)
```

> **Local port:** Both services default to `http://localhost:3000` and connect automatically. For mobile QR testing on the same Wi-Fi, set **Cloud Relay URL** in **Owner Settings** to your LAN IP (e.g., `http://192.168.1.50:3000`), or use a public `https://` URL for production.

- On first launch, the **3-step First-Run Setup Wizard** guides you through setting an Owner Password, saving your 12-word recovery phrase, and configuring printer, pricing, and Cloud Relay URL. On reinstall with existing data, choose **Keep Previous Data** or **Start Fresh**.
- Run Rust tests: `cd desktop-kiosk/src-tauri && cargo test`
- Build frontend: `cd desktop-kiosk && npm run build`

## Documentation

- **[Owner Setup Guide](OWNER_SETUP_GUIDE.md)** — Step-by-step guide for shop owners: installation, first-run setup, recovery phrase, pricing, printer, modes, password reset, updates, and troubleshooting.
- **[Developer Documentation](DEVELOPER_DOCS.md)** — Technical reference: APIs, WebSocket protocol, SQLite schema, Tauri commands/events, production deployment, and CI/CD.
- **[Tauri Auto-Updater Setup](desktop-kiosk/src-tauri/UPDATER_SETUP.md)** — Signing keypair generation and GitHub Actions secret configuration.
