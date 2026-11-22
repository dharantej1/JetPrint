<p align="center">
  <img src="desktop-kiosk/src-tauri/icons/128x128.png" width="108" height="108" alt="JetPrint Kiosk Icon: modern instant print kiosk icon">
</p>

<h1 align="center">JetPrint</h1>

<p align="center">
  <b>The self-service print kiosk system; an open-source, modern touch kiosk and mobile cloud relay.</b><br>
  Scan, upload from any mobile browser, pay via Razorpay UPI, and release prints via 6-digit OTP in seconds.<br>
  macOS · Windows · Linux · Raspberry Pi ARM64 · Mobile Web
</p>

<p align="center">
  <img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-b70228?style=flat-square">
  <img alt="Written in Rust" src="https://img.shields.io/badge/backend-Rust%20(Tauri%20v2)-8a011e?style=flat-square">
  <img alt="Frontend: React & TypeScript" src="https://img.shields.io/badge/frontend-React%20%2B%20TypeScript-3178c6?style=flat-square">
  <img alt="Cloud Relay: Node.js" src="https://img.shields.io/badge/relay-Node.js%20%2B%20ws-339933?style=flat-square">
  <img alt="Payments: Razorpay UPI" src="https://img.shields.io/badge/payments-Razorpay%20UPI-02042b?style=flat-square&logo=razorpay&logoColor=3395ff">
  <img alt="Platforms: macOS, Windows, Linux, Raspberry Pi" src="https://img.shields.io/badge/runs%20on-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux%20%C2%B7%20Raspberry%20Pi-b70228?style=flat-square">
  <img alt="Local-First Storage" src="https://img.shields.io/badge/storage-local%20SQLite-4b9fd5?style=flat-square">
</p>

<p align="center">
  <a href="https://github.com/sponsors/dharantej1" target="_blank" rel="noopener noreferrer">
    <img alt="Sponsor on GitHub" src="https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white">
  </a>
  &nbsp;&nbsp;
  <a href="https://www.paypal.com/ncp/payment/6GYEW6LMM7XLQ" target="_blank" rel="noopener noreferrer">
    <img alt="Donate with PayPal" src="https://img.shields.io/badge/Donate-PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white">
  </a>
  &nbsp;&nbsp;
  <a href="https://buymeacoffee.com/pusthakalaw" target="_blank" rel="noopener noreferrer">
    <img alt="Buy Me A Coffee" src="https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black">
  </a>
</p>

<p align="center">
  <a href="#highlights">Highlights</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#scan-upload--pay-in-seconds">Mobile</a> ·
  <a href="#kiosk-self-service--owner-modes">Kiosk</a> ·
  <a href="#turn-a-35-raspberry-pi-into-a-print-appliance">Raspberry Pi</a> ·
  <a href="#security-recovery--local-storage">Security</a> ·
  <a href="#how-its-built">Architecture</a> ·
  <a href="#get-started">Get started</a> ·
  <a href="#downloads">Downloads</a> ·
  <a href="#documentation">Documentation</a> ·
  <a href="#support">Support</a>
</p>

---

> [!NOTE]
> **JetPrint transforms any standard USB or network printer into an autonomous, self-service print station.**
> Designed for copy centers, universities, libraries, and coworking spaces. Customers require **zero app downloads or accounts**, payments settle instantly through UPI, and print jobs remain stored locally on your kiosk hardware.

---

## Highlights

<table>
<tr>
<td width="33%" valign="top">

### Instant & Contactless
Customers point their phone camera at the on-screen QR code, upload documents directly in Safari or Chrome, preview exact page counts and costs, and pay with any UPI app (GPay, PhonePe, Paytm). The instant 6-digit OTP releases their pages at the kiosk.

</td>
<td width="33%" valign="top">

### Appliance-Grade Resilient
Written in pure Rust on Tauri v2 with local SQLite, native CUPS and Windows spooler integration, and automated WebSocket reconnect loops. Runs 24/7 on hardware ranging from high-end PCs to a \$35 Raspberry Pi 4/5 with unattended boot-to-kiosk support. Guarantees zero lost orders through unacknowledged offline job flushes, reconnect active-job sync, and on-demand cloud OTP fallbacks.

</td>
<td width="33%" valign="top">

### Private & Yours
GNU AGPL v3 licensed with zero cloud lock-in. Print files download straight to your kiosk storage (`~/Documents/JetPrint KIOSK`) and are automatically deleted after 48 hours. Kiosk settings are protected by Argon2id passwords and a 12-word BIP-39 recovery seed phrase.

</td>
</tr>
<tr>
<td width="33%" valign="top">

### Multi-Printer Pools (10–20+ Printers)
Master-Detail hardware workspace with live interactive pool filter tabs (`B&W`, `Color`, `Large Format`, `Default`). Auto-detects CUPS and Windows printers, resolves network aliases, and automatically routes multi-file orders with round-robin balancing.

</td>
<td width="33%" valign="top">

### ⚡ Rush Hour Zero-OTP Auto-Print
Flip the high-visibility toolbar toggle in Owner Mode during peak hours to automatically dispatch incoming paid orders directly to the printer pool upon payment—eliminating customer OTP wait times and manual queue clicks. Built with a sequential FIFO queue, strict concurrency locks, and an automatic pending-job recovery sweep.

</td>
<td width="33%" valign="top">

### 🎯 Orientation Fidelity System
Smart JPEG EXIF auto-rotation (tags 1, 3, 6, 8), automated PDF normalization for landscape/rotated pages, and native macOS PDFKit spooling for converted images—preventing driver distortions, rotation clipping, and manual paper-feed prompts.

</td>
</tr>
</table>

---

## How it works

JetPrint bridges the physical printer, the kiosk screen, and the customer's phone through a lightweight, resilient event loop:

```text
  ┌─────────────────────────┐
  │ Customer Mobile Browser │
  └───────────┬─────────────┘
              │  1. Scans on-screen QR code (GET /upload?machine_id=<id>)
              │  2. Uploads PDFs or Images (page counts via pdf-lib)
              │  3. Pays via Razorpay UPI (or simulated Dev Mode)
              ▼
  ┌─────────────────────────┐
  │   Cloud Relay Server    │
  └───────────┬─────────────┘
              │  4. Verifies HMAC-SHA256 signature, generates 6-digit OTP
              │  5. Dispatches job over WebSocket (/ws); if kiosk is offline, holds unacknowledged jobs
              ▼
  ┌─────────────────────────┐
  │ Tauri v2 Desktop Kiosk  │  ◄── Downloads files to ~/Documents/JetPrint KIOSK/ (with retry backoff)
  └───────────┬─────────────┘  ◄── Inserts job + OTP into local SQLite (jetprint.db) & sends job_ack
              │                ◄── Syncs active jobs on reconnect & falls back to cloud OTP lookup
              │  6. Customer types OTP on touch keypad (or Owner prints from queue)
              ▼
  ┌─────────────────────────┐
  │  OS Print Spooler / CUPS│ ──► Physical Printer
  └─────────────────────────┘
```

---

## Scan, upload & pay in seconds

Customers never need to download an application, join a local Wi-Fi network, or register an account.

- **Zero App Footprint:** The mobile web app (`cloud-relay/public/`) opens in any modern smartphone browser immediately upon scanning the kiosk's dynamic QR code.
- **Accurate Pre-flight Page Analysis:** Server-side PDF analysis using `pdf-lib` extracts exact page counts and orientation before charging, eliminating pricing surprises.
- **Orientation Fidelity & EXIF Correction:** Detects smartphone camera EXIF rotation tags (tags 1, 3, 6, 8) and document viewports automatically, pre-normalizing landscape, portrait, and rotated images into print-ready layouts.
- **Native OS & PDFKit Spooling:** Prints PDFs and converted images on macOS via native PDFKit (`NSPrintOperation`) and sanitized CUPS properties on Linux, bypassing driver manual-feed prompts and orientation clipping.
- **Dynamic Per-Page Pricing:** Pricing syncs in real-time from the kiosk's local settings (B&W per-page, Color per-page, and custom shop branding).
- **Direct UPI & Razorpay Checkout:** Integrates seamlessly with Razorpay UPI payment gateway; webhook endpoints verify transactions using HMAC-SHA256 signatures before generating print tickets.
- **Built-in Dev Mode:** When Razorpay credentials are not configured, JetPrint automatically runs in sandbox simulation mode so you can test complete end-to-end printing flows for free.

<table>
<tr>
<td width="50%" valign="top">

#### Seamless Mobile Experience
1. **Camera scan**: Customer scans the dynamic machine QR code.
2. **Document upload**: Drag & drop or select PDFs, PNGs, and JPEGs.
3. **Print options**: Choose copies, Black & White, or Color.
4. **Pay**: Tap to trigger phone UPI intent or scan payment QR.
5. **Get OTP**: Instant display of the 6-digit release code.

</td>
<td width="50%" valign="top">

```sh
# Verify payment and status via the Cloud Relay API
curl -s http://localhost:3000/api/machines/kiosk_01
curl -s http://localhost:3000/api/jobs/job_9481/status

# JSON Response:
# {
#   "status": "paid",
#   "otp": "482910",
#   "amount_paise": 400,
#   "pages": 2
# }
```

</td>
</tr>
</table>

---

## Kiosk: Self-Service & Owner Modes

JetPrint features a dual-mode interface designed for high-throughput public spaces and straightforward shop administration:

<table>
<tr>
<td width="50%">

### 1. Self-Service Mode
- **High-Contrast QR Display:** Shows the real-time Cloud Relay connection state and machine ID.
- **Touch-Friendly Keypad with Cloud Fallback:** Large numeric keypad designed for responsive touchscreens; automatically queries Cloud Relay if an entered OTP is not found locally.
- **Audio & Visual Feedback:** Clear error messaging for expired or invalid OTP codes, with instant printing status spinners.

</td>
<td width="50%">

### 2. Owner Mode (Password Protected)
- **High-Throughput Print Queue:** Workflow category tabs (`Action Needed`, `Completed`, `Printed`, `All Jobs`), real-time OTP / file search, and instant queue sync with Cloud Relay (`syncActiveJobs`).
- **⚡ Rush Hour Auto-Print:** Instant dispatch upon payment settlement backed by a sequential FIFO queue, concurrency locking against duplicate spooling, and automatic pending job recovery sweep.
- **Touch-Optimized Display:** Fluid responsive layout with a 10px high-contrast scrollbar tailored for touch POS monitors.
- **Privacy & Security:** Completed documents are purged with reprint disabled to protect user data and prevent duplicate runs.
- **In-App Logs & Overrides:** Direct access to live diagnostic logs, date filtering, and per-file printer redirection.

</td>
</tr>
</table>

### Display & Tamper Protection
The kiosk launches in centered windowed mode by default and features a dedicated **Fullscreen Toggle** (or <kbd>F11</kbd> / <kbd>Esc</kbd>) locked behind the Owner Password. When deployed in public areas, customers cannot minimize, resize, or exit the kiosk interface without administrative credentials.

---

## Turn a \$35 Raspberry Pi into a print appliance

JetPrint provides native ARM64 Linux builds (`linux-aarch64`), enabling you to deploy a fully autonomous print kiosk on low-cost single-board hardware like a **Raspberry Pi 4** or **Raspberry Pi 5**.

```sh
# 1. Install runtime dependencies & JetPrint on Raspberry Pi OS 64-bit
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-0 libcups2 libappindicator3-1 librsvg2-2
sudo apt install ./JetPrint_*_arm64.deb

# 2. Add your printer in CUPS (http://localhost:631)
# JetPrint automatically detects default and network printers managed by CUPS

# 3. Enable unattended boot-to-kiosk in systemd or autostart
mkdir -p ~/.config/autostart
cat << 'EOF' > ~/.config/autostart/jetprint.desktop
[Desktop Entry]
Type=Application
Name=JetPrint Kiosk
Exec=/usr/bin/jetprint
X-GNOME-Autostart-enabled=true
EOF
```

CUPS handles raw spooling to thermal receipt printers, laser office printers, and industrial multi-function copiers over USB or IPP.

---

## Security, recovery & local storage

<table>
<tr>
<td width="50%" valign="top">

### Local-First Storage Directory
JetPrint stores all local state in the user's standard documents folder (`~/Documents/JetPrint KIOSK`):
- `jetprint.db`: High-performance SQLite database tracking jobs, configuration, and audit logs.
- `jobs/`: Local copies of downloaded PDFs and images queued for physical printing.
- `logs/jetprint.log`: Rolling diagnostic log file capturing system, printer, and WebSocket events.
- **Automated 48-Hour Cleanup:** Background worker automatically purges cached print files older than 48 hours to prevent storage exhaustion and protect user privacy.

</td>
<td width="50%" valign="top">

### Cryptographic Security & Reset
- **Argon2id Password Protection:** Owner credentials are never stored in plaintext; all administrative verification uses high-memory Argon2id hashing.
- **BIP-39 12-Word Seed Phrase:** Upon first initialization, the setup wizard generates a standardized 12-word cryptographic seed phrase. If an owner forgets their password, they can reset it instantly without database surgery or data loss.
- **State Migration & Resilience:** Reinstalling JetPrint automatically detects existing kiosk data, prompting you to **Keep Previous Data** or **Start Fresh**.

</td>
</tr>
</table>

---

## Multi-platform native engine & auto-updater

JetPrint is built on **Tauri v2**, combining a lightweight, secure Rust core with a responsive React frontend:

- **Ultra-Low Memory Footprint:** Idles at ~35–50 MB RAM, compared to 500+ MB for Electron equivalents.
- **Cryptographically Signed Auto-Updates:** In-app updates are verified against a Minisign public key and downloaded directly from GitHub Releases.
- **Dual-Path Update Resolution:** Employs an intelligent fallback resolver: if the primary manifest mirror is slow, it automatically queries GitHub Releases API with strict connect timeouts.
- **Automated Matrix CI:** Every release candidate is compiled and packaged across 15 matrix targets including macOS Apple Silicon (`aarch64`), macOS Intel (`x86_64`), Windows (`x64` NSIS & MSI), Linux x86_64, and Raspberry Pi ARM64.

---

## How it's built

JetPrint is organized as a modular repository separating the cloud relay facade from the native desktop kiosk:

| Component | Path | Tech Stack | Responsibility |
|---|---|---|---|
| **Cloud Relay** | [`cloud-relay/`](cloud-relay/) | Node.js, Express, `ws`, `pdf-lib`, Razorpay | Serves mobile upload UI, counts PDF pages, manages UPI orders, verifies webhooks, pushes OTPs over WebSocket, flushes unacknowledged offline jobs, and serves active-jobs / OTP fallback endpoints. |
| **Kiosk Core (Rust)** | [`desktop-kiosk/src-tauri/`](desktop-kiosk/src-tauri/) | Tauri v2, `rusqlite`, `printers`, `argon2`, `bip39`, `tokio` | Native OS printer spooling (CUPS & WinSpool), SQLite storage, WebSocket client with re-registration & `job_ack`, 3-attempt download retry backoff, on-demand OTP fallback, active jobs sync, 48h cleanup, and Minisign updater. |
| **Kiosk UI (React)** | [`desktop-kiosk/src/`](desktop-kiosk/src/) | React 18, TypeScript, Vite, Lucide | Self-Service touch keypad, QR display, Owner Mode print queue with cloud job sync, Rush Hour Auto-Print, and Dedicated Settings Workspace. |
| **Release Pipeline** | [`.github/workflows/`](.github/workflows/) | GitHub Actions, Tauri Action, Minisign | Multi-platform build matrix, artifact signing, and unified `latest.json` updater manifest consolidation. |

---

## Get started

### Prerequisites

- **Node.js 20+** and `npm`
- **Rust stable** (1.78+) and `cargo`
- **Native OS Build Tools**:
  - **macOS**: `xcode-select --install`
  - **Windows**: Microsoft C++ Build Tools & WebView2
  - **Linux / Raspberry Pi**:
    ```bash
    sudo apt-get update
    sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libcups2-dev
    ```

### 1. Launch Cloud Relay

```bash
cd cloud-relay
cp .env.example .env
npm install
npm run dev
```

*Runs on `http://localhost:3000`. Leave `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` blank to use simulated payment mode.*

### 2. Launch Desktop Kiosk

```bash
cd desktop-kiosk
npm install

# Option A: Run Vite UI only (browser preview at http://localhost:5173)
npm run dev

# Option B: Run full native desktop app with Rust backend
npx tauri dev
```

> [!TIP]
> **Mobile QR Testing on Local Wi-Fi:**
> To test mobile scanning from a physical phone on the same Wi-Fi network, open **Owner Settings** on the kiosk and change **Cloud Relay URL** to your computer's LAN IP address (e.g. `http://192.168.1.50:3000`).

---

## Downloads

Download production-ready installers from the [GitHub Releases](https://github.com/dharantej1/JetPrint/releases) page.

| Operating System | Architecture | Package Format | Notes |
|---|---|---|---|
| **macOS** | Apple Silicon (M1–M4) | `JetPrint_<ver>_aarch64.dmg` | Signed `.dmg` installer |
| **macOS** | Intel (x86_64) | `JetPrint_<ver>_x64.dmg` | Signed `.dmg` installer |
| **Windows** | 64-bit (x64) | `JetPrint_<ver>_x64-setup.exe` | Standard NSIS installer |
| **Windows** | 64-bit (x64) | `JetPrint_<ver>_x64.msi` | Enterprise MSI deployment package |
| **Linux** | x86_64 | `JetPrint_<ver>_amd64.deb` | Ubuntu, Debian, Mint |
| **Linux** | x86_64 | `JetPrint_<ver>_amd64.AppImage` | Portable universal binary |
| **Raspberry Pi** | ARM64 (`aarch64`) | `JetPrint_<ver>_arm64.deb` | Raspberry Pi OS 64-bit, Ubuntu ARM64 |
| **Raspberry Pi** | ARM64 (`aarch64`) | `JetPrint_<ver>_arm64.AppImage` | Portable ARM64 binary |

---

## Documentation

Detailed technical and operational manuals are available in the repository:

- 📖 **[Owner Setup Guide](OWNER_SETUP_GUIDE.md)** — Step-by-step kiosk setup for store managers, hardware recommendations, pricing configuration, CUPS/Windows printer pairing, and password recovery.
- 🛠️ **[Developer Documentation](DEVELOPER_DOCS.md)** — Technical reference: WebSocket wire protocol, REST API specs, SQLite database schema, Tauri IPC commands, and release pipelines.
- 🔐 **[Tauri Auto-Updater Guide](desktop-kiosk/src-tauri/UPDATER_SETUP.md)** — Minisign cryptographic keypair generation and GitHub Actions secrets configuration.

---

## Support

If you find JetPrint helpful and want to support ongoing development, hardware testing (Raspberry Pi setups, printer spoolers), and maintenance, consider buying a coffee or donating via PayPal:

<p align="center">
  <a href="https://github.com/sponsors/dharantej1" target="_blank" rel="noopener noreferrer">
    <img src="https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Sponsor on GitHub" />
  </a>
  &nbsp;&nbsp;
  <a href="https://www.paypal.com/ncp/payment/6GYEW6LMM7XLQ" target="_blank" rel="noopener noreferrer">
    <img src="https://raw.githubusercontent.com/stefan-niedermann/paypal-donate-button/master/paypal-donate-button.png" alt="Donate with PayPal" height="42" />
  </a>
  &nbsp;&nbsp;
  <a href="https://buymeacoffee.com/pusthakalaw" target="_blank" rel="noopener noreferrer">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="42" />
  </a>
  <br><br>
  <a href="https://www.paypal.com/ncp/payment/6GYEW6LMM7XLQ" target="_blank" rel="noopener noreferrer">
    <img src="https://www.paypalobjects.com/images/Debit_Credit_APM.svg" alt="Cards: Visa, Mastercard, Amex, Discover" />
  </a>
</p>

<p align="center">
  <sub>GitHub Sponsors: <a href="https://github.com/sponsors/dharantej1" target="_blank" rel="noopener noreferrer"><b>github.com/sponsors/dharantej1</b></a> · PayPal: <a href="https://paypal.me/dharantej1" target="_blank" rel="noopener noreferrer"><b>paypal.me/dharantej1</b></a> · Buy Me a Coffee: <a href="https://buymeacoffee.com/pusthakalaw" target="_blank" rel="noopener noreferrer"><b>buymeacoffee.com/pusthakalaw</b></a></sub>
</p>

---

## License and credits

JetPrint is free and open-source software licensed under the **[GNU Affero General Public License v3.0](LICENSE)** (AGPL-3.0).

Built with passion for independent print shops, students, and open-source communities.
