# JetPrint Owner Setup Guide

**JetPrint Kiosk** setup guide for shop owners — no technical background required.

> For developer & hosting documentation, see [`DEVELOPER_DOCS.md`](DEVELOPER_DOCS.md) and [`README.md`](README.md).

## Table of Contents

- [1. Installing & Launching JetPrint Kiosk](#1-installing--launching-jetprint-kiosk)
  - [macOS (Apple Silicon M1–M4 & Intel)](#macos-apple-silicon-m1m4--intel)
  - [Windows (10 / 11)](#windows-10--11)
  - [Linux (Ubuntu / Debian & AppImage)](#linux-ubuntu--debian--appimage)
  - [Raspberry Pi (Raspberry Pi OS 64-bit & ARM64)](#raspberry-pi-raspberry-pi-os-64-bit--arm64)
- [2. Storage Location, Reinstalling & Upgrading](#2-storage-location-reinstalling--upgrading)
  - [Storage Directory Structure](#storage-directory-structure)
  - ["Keep Previous Data" vs "Start Fresh"](#keep-previous-data-vs-start-fresh)
- [3. First-Run Setup Wizard (3 Steps)](#3-first-run-setup-wizard-3-steps)
- [4. Understanding the Connection Status Pill](#4-understanding-the-connection-status-pill)
- [5. Dedicated Owner Settings Workspace](#5-dedicated-owner-settings-workspace)
- [6. Printers & Multi-Printer Pools (Managing 10–20+ Printers)](#6-printers--multi-printer-pools-managing-1020-printers)
  - [Printer Capability Tagging & Smart Pool Routing](#printer-capability-tagging--smart-pool-routing)
  - [Cross-Platform Print Engines & Native macOS PDFKit Spooling](#cross-platform-print-engines--native-macos-pdfkit-spooling)
  - [Orientation Fidelity: JPEG EXIF Auto-Rotation & Landscape Normalization](#orientation-fidelity-jpeg-exif-auto-rotation--landscape-normalization)
  - [Per-Page Pricing & Paper Sizes](#per-page-pricing--paper-sizes)
  - [Window & Display: Windowed Mode and Fullscreen Toggle](#window--display-windowed-mode-and-fullscreen-toggle)
  - [Storage Folder & System Diagnostic Logs](#storage-folder--system-diagnostic-logs)
- [7. Operating Modes: Self-Service, Owner Queue & Rush Hour Auto-Print](#7-operating-modes-self-service-owner-queue--rush-hour-auto-print)
  - [⚡ Rush Hour Auto-Print Mode (Zero-OTP Printing)](#-rush-hour-auto-print-mode-zero-otp-printing)
  - [Rush Hour Reliability: FIFO Queue, Concurrency Lock & Recovery Sweep](#rush-hour-reliability-fifo-queue-concurrency-lock--recovery-sweep)
  - [Per-File Printer Overrides in Owner Queue](#per-file-printer-overrides-in-owner-queue)
  - [Filtering the Owner Mode Print Queue by Date](#filtering-the-owner-mode-print-queue-by-date)
- [8. Resetting a Forgotten Password](#8-resetting-a-forgotten-password)
- [9. Installing App Updates](#9-installing-app-updates)
- [10. Troubleshooting](#10-troubleshooting)

---

## 1. Installing & Launching JetPrint Kiosk

Download the installer for your OS from the GitHub Releases page, connect your printer, and launch **JetPrint Kiosk**.

### macOS (Apple Silicon M1–M4 & Intel)

1. **Download the right `.dmg`**:
   - **Apple Silicon** (M1–M4): download the **`aarch64`** `.dmg`.
   - **Intel**: download the **`x64`** `.dmg`.
2. **Install**: Double-click the `.dmg`, then drag **JetPrint** into **Applications**.
3. **If macOS Gatekeeper blocks launch**:
   - In **Finder → Applications**, right-click **JetPrint** and choose **Open**, then click **Open**.
   - Or go to **System Settings → Privacy & Security** and click **Open Anyway**.
4. **Add your printer**: Open **System Settings → Printers & Scanners**, add your printer, and print a test page.
5. **Launch**: Open **JetPrint** from Applications, complete the [First-Run Setup Wizard](#3-first-run-setup-wizard-3-steps), and confirm the status pill shows **Relay Online**.

### Windows (10 / 11)

1. **Download & install**: Run the **`.exe`** (NSIS) or **`.msi`** installer from the release page.
2. **If Windows SmartScreen warns you**: Click **More info → Run anyway**.
3. **Add your printer**: Open **Settings → Bluetooth & devices → Printers & scanners**, confirm your printer is listed, and print a test page.
4. **Launch**: Open **JetPrint** from the Start Menu, complete the [First-Run Setup Wizard](#3-first-run-setup-wizard-3-steps), and verify **Relay Online** in the header.

### Linux (Ubuntu / Debian & AppImage)

1. **Install**:
   - **`.deb`**:
     ```bash
     sudo apt update
     sudo apt install ./JetPrint_*.deb
     ```
   - **`.AppImage`**:
     ```bash
     chmod +x JetPrint_*.AppImage
     ./JetPrint_*.AppImage
     ```
     *Requires `libwebkit2gtk-4.1-0` and `libcups2` on minimal systems (`sudo apt install libwebkit2gtk-4.1-0 libcups2`).*
2. **Add your printer**: Use **System Settings → Printers** or the CUPS web interface at `http://localhost:631`.
3. **Launch**: Open **JetPrint** from the app menu, complete the [First-Run Setup Wizard](#3-first-run-setup-wizard-3-steps), and verify **Relay Online** in the header.

### Raspberry Pi (Raspberry Pi OS 64-bit & ARM64)

JetPrint runs directly on ARM64 single-board computers, turning a Raspberry Pi into a dedicated, low-power print kiosk.

> **Recommended Hardware & OS**:
> - **Raspberry Pi 4 Model B** (4 GB / 8 GB) or **Raspberry Pi 5**
> - **Raspberry Pi OS Bookworm (64-bit)** with desktop environment

#### 1. Install Runtime Dependencies & `.deb` Package
1. Download the ARM64 `.deb` package (e.g. `JetPrint_*_arm64.deb` or `JetPrint_*_amd64.deb` depending on your architecture) from the GitHub Releases page onto your Pi.
2. Open terminal and install the required runtime libraries:
   ```bash
   sudo apt update
   sudo apt install -y libwebkit2gtk-4.1-0 libcups2 libappindicator3-1 librsvg2-2
   ```
3. Install the JetPrint Debian package:
   ```bash
   sudo apt install ./JetPrint_*_arm64.deb
   ```
   *(If installing with `sudo dpkg -i`, resolve any missing dependencies with `sudo apt --fix-broken install -y`.)*

#### 2. Configure Your Printer in CUPS
JetPrint connects to any printer recognized by the Linux CUPS print spooler:
1. Open a web browser on the Pi and visit the CUPS administration page at **`http://localhost:631`** (or open Raspberry Pi OS desktop **Preferences → Print Settings**).
2. Under **Administration → Printers**, click **Add Printer**, detect your USB or network printer, assign the manufacturer driver/PPD, and print a test page to verify.
3. Set it as the default printer, or select it inside JetPrint Owner Settings later.

#### 3. Configure Kiosk Mode Autostart (Boot Straight into Fullscreen JetPrint)
To operate the Raspberry Pi as a dedicated appliance that launches JetPrint on boot without showing the desktop:

- **Desktop Session Autostart (`.desktop` entry)**:
  Create the user autostart folder and desktop launcher:
  ```bash
  mkdir -p ~/.config/autostart
  nano ~/.config/autostart/jetprint.desktop
  ```
  Paste the following configuration and save (`Ctrl+O`, `Enter`, `Ctrl+X`):
  ```ini
  [Desktop Entry]
  Type=Application
  Name=JetPrint Kiosk
  Exec=jetprint
  X-GNOME-Autostart-enabled=true
  Terminal=false
  ```

- **Wayland / Wayfire Kiosk Autostart (Raspberry Pi OS Bookworm default)**:
  Raspberry Pi OS Bookworm uses the Wayfire Wayland compositor by default. You can append JetPrint to `~/.config/wayfire.ini`:
  ```ini
  [autostart]
  jetprint = jetprint
  screensaver = false
  dpms = false
  ```

- **Disable Screen Sleep / Blanking**:
  Prevent the kiosk display from sleeping during operating hours:
  - Run `sudo raspi-config` → **Display Options** → **Screen Blanking** → select **No** (Disable).
  - Or in the desktop menu, navigate to **Preferences → Raspberry Pi Configuration → Display** and turn off **Screen Blanking**.

- **Launch & Wizard**:
  Reboot (`sudo reboot`) or launch **JetPrint** from the application menu or terminal (`jetprint`). Complete the [First-Run Setup Wizard](#3-first-run-setup-wizard-3-steps), configure pricing and your printer, and verify that the status pill shows **Relay Online**.

---

## 2. Storage Location, Reinstalling & Upgrading

### Storage Directory Structure

JetPrint stores all local application data, print files, and diagnostics in a dedicated user-accessible folder:
- **Default Location**: `~/Documents/JetPrint KIOSK` (or your operating system's standard Documents directory).
- **Contents**:
  - `jetprint.db` (and SQLite `-wal` / `-shm`): Local database storing Machine ID, password hash, recovery phrase hash, shop settings, pricing, and job history.
  - `jobs/`: Temporary storage for downloaded customer print documents (PDFs and images). Job files are automatically purged after 48 hours to conserve disk space, while job records remain in the database.
  - `logs/jetprint.log`: Rolling diagnostic log file capturing WebSocket connectivity, print dispatch events, and error traces.

> **Automatic Migration**: When upgrading from an older version of JetPrint that stored files in system app data directories, JetPrint automatically detects and moves your database, existing job files, and logs into `~/Documents/JetPrint KIOSK` on first startup without data loss.

### "Keep Previous Data" vs "Start Fresh"

When a new build or reinstallation detects an existing database in your storage directory, an **Existing Data Detected** prompt appears showing your saved **Machine ID** and job count:

- **Keep Previous Data** *(recommended for normal upgrades)*: Preserves your Machine ID, password, recovery phrase, settings, and job history, and resumes immediately.
- **Start Fresh (Remove Previous Data)** *(recommended when resetting a test machine or setting up a new shop)*: Permanently deletes previous job history, settings, and credentials; generates a new Machine ID; and launches the First-Run Setup Wizard. Requires confirmation (**Yes, Remove Data & Start Fresh**) — this action cannot be undone.

---

## 3. First-Run Setup Wizard (3 Steps)

Appears automatically on first launch or after **Start Fresh**:

1. **Step 1 — Create Owner Password**:
   - Enter an **Admin Password** (minimum 6 characters) and confirm it.
   - Click **Continue & Generate Recovery Phrase**.
2. **Step 2 — Save Your 12-Word Recovery Phrase**:
   - Write all 12 words down in exact order and store them safely (or click **Copy 12-Word Phrase** to save to a password manager).
   - **This phrase is the only way to reset your password if you forget it.**
   - Check **"I have saved my recovery phrase"** and click **Continue to Printer & Relay Setup**.
3. **Step 3 — Configure Printer, Pricing & Cloud Relay**:
   - **Default Printer**: Select your printer from the dropdown (or leave on **System Default**).
   - **Per-Page Pricing (₹)**: Set **B&W** (default `2.00`) and **Color** (default `10.00`) prices.
   - **Cloud Relay URL**: Enter your relay server address (defaults to `http://localhost:3000`; use a public `https://` URL in production or your LAN IP like `http://192.168.1.50:3000` for Wi-Fi testing).
   - Click **Save & Launch Kiosk** — or **Skip for Now** to configure later in **Owner Settings**.

---

## 4. Understanding the Connection Status Pill

The **status pill** in the top-right header shows your Cloud Relay connection at a glance:

| Status Pill | Indicator | Meaning & Action |
|---|---|---|
| **`Relay Online`** | Green dot | Connected. Pricing is synced and jobs will arrive automatically. |
| **`Connecting...`** | Amber dot | Connecting or reconnecting. Stale error notices are cleared automatically while reconnecting. Wait a few seconds; if it persists, check your internet or Cloud Relay URL. |
| **`Relay Offline`** | Red dot | Disconnected. Check your internet, verify **Cloud Relay URL** in Owner Settings, and click **Save Settings** to reconnect. |

> **Machine Identity & Re-Registration Protocol**:
> Your kiosk maintains a permanent, unique **Machine ID** (e.g. `kiosk_a1b2c3d4`). When reconnecting or after resetting settings, JetPrint automatically performs a deterministic re-registration with Cloud Relay, preserving your Machine ID and clearing out any stale authentication errors without requiring you to regenerate your customer QR codes or reconfigure the shop.

---

## 5. Dedicated Owner Settings Workspace

Access shop settings at any time:

- Click the **gear icon** in the top-right corner, **or**
- Press **`Ctrl + Shift + S`** (Windows/Linux) or **`Cmd + Shift + S`** (macOS), **or**
- Tap the **bottom-right corner** 5 times quickly.

Enter your **Owner Password** on the keypad and click **Unlock Settings**.

Once unlocked, JetPrint transitions into a **Full-Page Dedicated Settings Workspace** featuring:
- **`← Back to Kiosk`** button in the header to return instantly to the customer screen or print queue.
- **Machine ID Pill**: Shows your kiosk's full unique Machine ID.
- **Sidebar Navigation**:
  - **Printers & Pools**: Manage connected hardware, capability tags, pools, and test prints.
  - **Pricing & Paper**: Configure per-page rates and active paper sizes.
  - **Operating Mode**: Toggle between Self-Service, Owner Queue, and Rush Hour Auto-Print.
  - **Cloud Relay**: Server endpoint, instant reconnect, machine token, and storage paths.
  - **System & Updates**: Display controls, system logs, and version updates.

---

## 6. Printers & Multi-Printer Pools (Managing 10–20+ Printers)

JetPrint supports scaling from a single counter printer to high-volume print shops managing **10 to 20+ printers**.

### Master-Detail Interface & Interactive Pool Filters

Under the **Printers & Pools** tab, JetPrint provides an ergonomic Master-Detail configuration workspace:

1. **Interactive Pool Filter Tabs (Header)**:
   - Filter your printer list instantly by pool: **All Available**, **B&W Pool**, **Color Pool**, **Large Format**, and **Default Pool**.
   - Each tab displays live counter pills showing how many active printers belong to that specific queue.
2. **Master Printer List (Left Column)**:
   - Lists every detected printer with live status indicators, default printer badges, and pool assignment tags.
   - Selecting any printer opens its detailed settings in the right pane.
3. **Detail Configuration Workspace (Right Column)**:
   - **Printer Routing Status**: Toggle any printer active or disabled with a single click without disconnecting hardware.
   - **Display Nickname**: Assign intuitive labels (e.g., *"Counter 1 - Fast Laser"*, *"Photo Station - Epson L805"*, *"Back Office - A3 Plotter"*).
   - **Pool Assignment**: Assign to `B&W Pool (Monochrome)`, `Color Pool`, `Large Format Pool`, or `Default Pool`.
   - **Capability Tags**: Toggle smart routing attributes (`B&W`, `Color`, `A4`, `A3`, `Legal`, `Duplex`).
   - **Default Printer Selection**: Designate the kiosk primary fallback printer with one click (**Default Selected**).
   - **Test Print**: Send a diagnostic alignment test page directly to the selected printer.
4. **Rescan System Printers**:
   - Click **Rescan System Printers** in the header anytime new USB or network printers are connected.

### Cross-Platform Print Engines & Native macOS PDFKit Spooling

JetPrint works seamlessly across macOS, Linux, and Windows print spoolers:
- **macOS Native PDFKit Engine (`NSPrintOperation`)**: On macOS (Apple Silicon M1–M4 & Intel), all PDF documents and converted image files route through Apple's native PDFKit subsystem (`macos_print_pdf` using `kPDFPrintPageScaleToFit` and `autoRotate: NO`). This completely eliminates printer driver crashes, unwanted manual paper feed prompts, and rotation distortion common to raw `lp` CUPS commands on macOS.
- **Linux & CUPS Spooling**: Automatically detects and resolves Bonjour network ghost loopback aliases (e.g. `<PrinterName> @ <Hostname>` mapped back to the canonical system queue), eliminating loopback duplicate entries and ghost printer errors. Uses sanitized CUPS properties (`orientation-requested: 3`, auto tray selection) so printers pull reliably from the main cassette.
- **Windows (Print Spooler)**: Directly queries Windows Spooler APIs (`winspool`) with automatic device matching.
- **Non-Blocking Spooling**: Print jobs and test pages run in asynchronous background worker threads (`tokio::task::spawn_blocking`) with 30-second timeouts, keeping the UI completely fluid and responsive during large multi-page spools.
- **Automatic Default Fallback**: If a targeted printer is disconnected, renamed, or temporarily unavailable, JetPrint automatically reroutes jobs to the system default printer rather than dropping customer prints.

### Orientation Fidelity: JPEG EXIF Auto-Rotation & Landscape Normalization

Customer documents arrive from diverse smartphone cameras, scanners, and software:
- **JPEG EXIF Auto-Rotation**: Smartphone cameras embed EXIF metadata orientation tags (tags 1, 3, 6, 8) that often cause portrait photos or scans to appear sideways or inverted when printed. JetPrint inspects EXIF markers at pre-flight and rotates the image to its natural upright position before generating the print-ready PDF.
- **Landscape & Mixed-Page Normalization**: In documents with landscape pages or rotated viewports, JetPrint's pre-flight pipeline pre-rotates and normalizes the pages into print-ready PDF assets (`print_ready: true`). This ensures the kiosk spooler prints them with exact aspect ratios and margins without relying on unpredictable printer driver auto-rotate algorithms.
- **Unified PDF Detection (`is_pdf_file`)**: The kiosk print engine detects PDFs across file extensions, MIME types, `print_ready` metadata, and `%PDF` magic bytes, guaranteeing that converted images receive the same high-fidelity treatment as native vector PDFs.

### Per-File Smart Routing & Load Balancing

- **Smart Pool Matching**: In multi-file orders (e.g., a customer printing both a monochrome report and a color photo), JetPrint automatically splits the order, sending B&W pages to the B&W laser pool and color pages to the photo pool.
- **Round-Robin Load Balancing**: When multiple printers share a pool, jobs are distributed evenly to maximize output speed.

### Per-Page Pricing & Paper Sizes

Under the **Pricing & Paper** tab:
1. **Per-Page Pricing (₹)**:
   - Set **B&W Price per Page** (default `₹2.00`) and **Color Price per Page** (default `₹10.00`).
   - Prices sync to Cloud Relay instantly so customers see accurate charges on their phones.
2. **Supported Paper Sizes**:
   - Toggle enabled sizes (`A4`, `A3`, `Legal`, `Letter`). Disabled sizes are blocked on the mobile upload interface.

### Window & Display: Windowed Mode and Fullscreen Toggle

- JetPrint launches in a centered, resizable windowed mode by default, making setup and initial testing convenient.
- **Securing Fullscreen for Kiosks**: To prevent walk-up customers from resizing, minimizing, or exiting the application on unattended kiosks, the **Fullscreen Toggle** button is restricted to the password-protected **Dedicated Settings** space under **System & Updates**.
- Click **Enter Fullscreen** to expand JetPrint edge-to-edge across the screen.
- To exit fullscreen, re-open Settings and click **Exit Fullscreen**, or use the keyboard shortcuts **`Escape`** or **`F11`**.

### Storage Folder & System Diagnostic Logs

- **Storage Location**: Displays the active path (`~/Documents/JetPrint KIOSK`) and current disk usage. Click **Browse** to change the root storage folder or point to an external drive.
- **View System Logs**: Opens the dedicated Logs Window showing real-time event logs (relay pings, job dispatches, printer commands) with options to refresh, copy, or clear log history.

---

## 7. Operating Modes: Self-Service, Owner Queue & Rush Hour Auto-Print

In **Settings → Operating Mode**, choose your shop mode and click **Save Changes**:

- **Self-Service Mode** *(recommended for unattended kiosks)*:
  - Displays the customer QR code and 6-digit OTP keypad.
  - Customers upload, pay on their phone, receive an OTP, and release their prints at the kiosk.
  - **On-Demand Cloud OTP Fallback**: If a customer pays while the kiosk is starting up or temporarily disconnected, entering their 6-digit code on the keypad triggers an instant on-demand query to Cloud Relay. The kiosk downloads the files with automatic retry backoff, acknowledges receipt, and prints immediately—no manual staff intervention required.
- **Owner Mode** *(recommended when staff operate the print counters)*:
  - Displays the QR code alongside a high-throughput **Owner Mode Print Queue**.
  - Paid jobs appear in real time with file details, copies, and assigned printers.

### Owner Mode Queue: High-Throughput Rush Hour Workflow

The Owner Mode Queue is built for busy store environments handling hundreds of jobs:

1. **Workflow Category Filter Tabs**:
   - **`Action Needed`**: Shows incoming paid jobs requiring physical release or staff action.
   - **`Completed`**: Shows all finished jobs (both successfully printed and cancelled).
   - **`Printed`**: Filters exclusively to jobs that have completed physical printing.
   - **`All Jobs`**: Complete chronological archive of all incoming jobs.
2. **Real-Time OTP & Filename Search**:
   - Use the **`Quick search OTP or file...`** bar for instant substring filtering by 6-digit customer OTP or filename.
3. **Touch-Friendly 10px Scrollbar**:
   - A prominent 10px high-contrast scrollbar provides effortless scrolling on touch POS monitors and tablets.
4. **Dynamic Fluid Layout**:
   - Automatically scales from 1080p touch monitors to ultrawide counter screens and 4K displays without horizontal clipping.
5. **Document Purging & Security Policy**:
   - To protect customer privacy and comply with data security standards, customer files are purged once printed (and automatically wiped after 48 hours). The **Re-Print** button is disabled for completed jobs to prevent accidental reprints.

### ⚡ Rush Hour Auto-Print Mode (Zero-OTP Printing)

During peak hours when customer queues form:
- **Owner Queue Toolbar Toggle**: Click **⚡ Rush Hour Auto-Print** on the top toolbar (styled consistently alongside **Logs** and **Refresh**).
- **Auto-Dismiss Notice**: A clean amber notice confirms activation and automatically vanishes after 10 seconds to keep the workspace unobstructed.
- **Owner Mode Guard**: Rush Hour Auto-Print is restricted exclusively to Owner Mode to ensure staff is actively attending the printer trays.
- **Zero-Touch Printing**: Incoming customer orders print immediately upon payment settlement without manual clicks or OTP verification. Toggle it off anytime when rush hour ends.

### Rush Hour Reliability: FIFO Queue, Concurrency Lock & Recovery Sweep

To handle intense rush hour traffic without printer spooler collisions or lost orders, JetPrint features a robust three-tier execution system:
1. **Sequential FIFO Print Queue**:
   Incoming paid jobs are queued in a strict First-In, First-Out (FIFO) pipeline. Jobs are dispatched one by one in the exact chronological order payment was confirmed, preventing spooler overflow, buffer congestion, and out-of-order document output.
2. **Strict Concurrency Lock**:
   An atomic state guard prevents parallel print commands from firing simultaneously. While a document is actively spooling or printing, subsequent jobs wait safely in the queue. This completely eliminates driver deadlocks, duplicate page runs, and port collisions.
3. **Automatic Pending Job Recovery Sweep**:
   Whenever Rush Hour Auto-Print is activated (or if the kiosk starts up with Rush Hour mode enabled), JetPrint instantly sweeps the local SQLite database for any `pending` paid jobs—such as orders completed during a momentary network interruption, app restart, or while the kiosk was idle. All unprinted jobs are automatically loaded into the FIFO queue and printed immediately, ensuring zero lost orders during hectic shifts.

### Per-File Printer Overrides in Owner Queue

Each file in a customer's job card displays an inline printer badge:
- Shows the auto-routed printer (e.g. `[HP LaserJet (B&W)]`).
- Click the dropdown to override and redirect that specific file to any other printer before printing.
- Click **⚡ Direct Print** to immediately print that job without requiring an OTP.

### Filtering the Owner Mode Print Queue by Date

The Print Queue header includes date navigation:
- **Today** *(default)*: Shows only today's jobs.
- **All**: Shows all saved jobs with timestamps.
- **Date Picker**: Select any past date to view jobs from that day.
- The counter on the right shows matching job count; clicking **Refresh** spins and triggers active synchronization (`sync_active_jobs`), fetching any unprinted orders paid while the app was closed directly from Cloud Relay into your queue.

---

## 8. Resetting a Forgotten Password

1. Open **Owner Settings** (gear icon, `Ctrl+Shift+S`/`Cmd+Shift+S`, or 5-tap corner).
2. Click **Forgot Password? Reset with 12-word Phrase**.
3. Enter your **12-Word BIP39 Recovery Phrase** (all 12 words in order, space-separated).
4. Enter a **New Owner Password** (minimum 6 characters) and click **Reset Password**.
5. Sign in with your new password.

---

## 9. Installing App Updates

JetPrint features a built-in native updater powered by Rust:

1. **Automatic Silent Check**:
   - On startup, JetPrint performs a silent background update check without interrupting ongoing kiosk operations.
   - Dual-path check: queries the GitHub Releases API directly with Fastly CDN fallback and a 2.5-second connect timeout to prevent network stalls.
2. **Manual On-Demand Check**:
   - Open **Owner Settings** and click **Check for Updates**.
   - The current version is displayed alongside check status. If already up to date, it confirms with a green checkmark (`Up to date (vX.Y.Z)`).
3. **One-Click In-App Update & Restart**:
   - When a new version is available, an **Update vX.Y.Z** badge appears in the header and an update banner displays in Owner Settings showing the release notes.
   - Click **Install Update & Restart**.
   - JetPrint downloads the package, validates its cryptographic Minisign signature, installs the new version, and automatically restarts.
   - All shop data, passwords, and print records in `~/Documents/JetPrint KIOSK` are preserved automatically.

---

## 10. Troubleshooting

| Issue | How to Fix |
|---|---|
| **Customer phone cannot open QR code** | Set **Cloud Relay URL** to a public `https://` URL (for cellular) or your LAN IP (`http://192.168.x.x:3000` for same-Wi-Fi testing) — not `localhost`. |
| **Header shows `Connecting...` or `Relay Offline`** | Check your internet, confirm the Cloud Relay server is running, verify **Cloud Relay URL** in Owner Settings, and click **Save Settings**. |
| **Printer not listed or fails to print** | Confirm the printer is on, connected, and added in OS settings (macOS Printers & Scanners / Windows Printers & scanners / Linux CUPS), then reselect it in **Owner Settings → Default Printer**. |
| **Prompted with "Existing Data Detected" after reinstall** | Choose **Keep Previous Data** to keep your settings and history, or **Start Fresh** to wipe and re-run setup. |
| **Exit Fullscreen Mode** | Press **`Escape`** or **`F11`**, or open **Owner Settings → Window & Display** and click **Exit Fullscreen**. |
| **Cannot locate database or log files** | Open `~/Documents/JetPrint KIOSK` (or click **Open Folder** in Owner Settings) to access `jetprint.db`, `jobs/`, and `logs/jetprint.log`. |
| **Update check times out or fails** | Verify internet connectivity. Open Owner Settings and click **Check for Updates** to retry via the resilient dual-path updater. |
| **Forgot Owner Password** | Click **Forgot Password? Reset with 12-word Phrase** in the Owner Authentication modal and enter your recovery phrase. |
| **Touchscreen Kiosk has no physical keyboard** | **Self-Service Mode** uses JetPrint's built-in numeric keypad on screen (customers never need an OS keyboard). In **Owner Settings** or **First-Run Setup**, tap the keyboard icon next to any input field to open the built-in touch keyboard. |
| **Windows Touch Keyboard (TabTip) does not pop up** | If running Windows in desktop mode without tablet auto-invoke, either tap the in-app keyboard button, or enable Windows Touch Keyboard in desktop mode: run PowerShell as Admin: `Set-ItemProperty -Path "HKCU:\Software\Microsoft\TabletTip\1.7" -Name "EnableDesktopModeAutoInvoke" -Value 1`. |
| **Mobile photo or document prints sideways or upside down** | JetPrint automatically detects and corrects JPEG EXIF orientation tags (1, 3, 6, 8) and normalizes rotated PDF viewports at upload. Ensure the customer has uploaded the original JPEG/PNG or PDF without external screenshot cropping. |
| **Printer requests manual paper feed / bypass tray** | JetPrint routes macOS prints via native PDFKit with `kPDFPrintPageScaleToFit` and sanitizes CUPS spooler properties (`orientation-requested: 3`, auto tray selection), suppressing manual feed prompts across major printer brands. |
| **Customer paid during temporary kiosk offline or app restart** | JetPrint guarantees zero lost orders via four layers of protection: (1) **WebSocket Flush**: Upon reconnecting, Cloud Relay automatically flushes all unacknowledged jobs paid while the desktop app was closed; (2) **Active Jobs Sync**: The kiosk automatically syncs with Cloud Relay on reconnect (and whenever clicking **Refresh** in Owner Mode); (3) **On-Demand OTP Fallback**: If a customer enters an OTP at the keypad not yet saved locally, the kiosk fetches the job from Cloud Relay on demand with download retry backoff; (4) **Rush Hour Sweep**: In Rush Hour mode, the recovery sweep loads all pending orders into the FIFO queue and prints them sequentially. |
