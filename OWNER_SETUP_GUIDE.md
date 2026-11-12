# JetPrint Owner Setup Guide

**JetPrint Kiosk** setup guide for shop owners — no technical background required.

> For developer & hosting documentation, see [`DEVELOPER_DOCS.md`](DEVELOPER_DOCS.md) and [`README.md`](README.md).

## Table of Contents

- [1. Installing & Launching JetPrint Kiosk](#1-installing--launching-jetprint-kiosk)
  - [macOS (Apple Silicon M1–M4 & Intel)](#macos-apple-silicon-m1m4--intel)
  - [Windows (10 / 11)](#windows-10--11)
  - [Linux (Ubuntu / Debian & AppImage)](#linux-ubuntu--debian--appimage)
- [2. Reinstalling or Upgrading: "Start Fresh" vs "Keep Previous Data"](#2-reinstalling-or-upgrading-start-fresh-vs-keep-previous-data)
- [3. First-Run Setup Wizard (3 Steps)](#3-first-run-setup-wizard-3-steps)
- [4. Understanding the Connection Status Pill](#4-understanding-the-connection-status-pill)
- [5. Opening Owner Settings](#5-opening-owner-settings)
- [6. Configuring Relay URL, Default Printer, and Per-Page Pricing](#6-configuring-relay-url-default-printer-and-per-page-pricing)
- [7. Switching Between Self-Service Mode and Owner Mode](#7-switching-between-self-service-mode-and-owner-mode)
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

---

## 2. Reinstalling or Upgrading: "Start Fresh" vs "Keep Previous Data"

JetPrint stores its local database (`jetprint.db` — Machine ID, password, recovery phrase, settings, and job history) in your computer's app data folder, preserved across updates and reinstalls.

When a new build detects existing data, an **Existing Data Detected** prompt appears showing your saved **Machine ID** and job count:

- **Keep Previous Data** *(recommended for normal upgrades)*: Keeps your Machine ID, password, recovery phrase, settings, and job history, and resumes immediately.
- **Start Fresh (Remove Previous Data)** *(recommended when resetting a test machine or new shop)*: Permanently deletes job history, settings, and credentials; generates a new Machine ID; and launches the First-Run Setup Wizard. Requires confirmation (**Yes, Remove Data & Start Fresh**) — this cannot be undone.

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
| **`Connecting...`** | Amber dot | Connecting or reconnecting. Wait a few seconds; if it persists, check your internet or Cloud Relay URL. |
| **`Relay Offline`** | Red dot | Disconnected. Check your internet, verify **Cloud Relay URL** in Owner Settings, and click **Save Settings** to reconnect. |

---

## 5. Opening Owner Settings

Access shop settings at any time:

- Click the **gear icon** in the top-right corner, **or**
- Press **`Ctrl + Shift + S`** (Windows/Linux) or **`Cmd + Shift + S`** (macOS), **or**
- Tap the **bottom-right corner** 5 times quickly.

Enter your **Owner Password** and click **Unlock Settings**.

---

## 6. Configuring Relay URL, Default Printer, and Per-Page Pricing

Inside **Owner Settings**:

1. **Default Printer**: Choose your printer from the dropdown (or leave on **System Default**).
2. **Per-Page Pricing (₹)**:
   - Set **B&W Price per Page** (default `2.00`) and **Color Price per Page** (default `10.00`).
   - Prices sync to the Cloud Relay automatically on save, so customers see the correct price on their phone.
3. **Cloud Relay URL**: Enter your relay server address (e.g., `https://relay.yourshop.com`).
   - **For customers on cellular data**, this must be a public `https://` URL. For same-Wi-Fi testing, use your LAN IP (e.g., `http://192.168.1.50:3000`) instead of `localhost`.
4. Click **Save Settings** and confirm the **Relay Online** pill in the header.

---

## 7. Switching Between Self-Service Mode and Owner Mode

In **Owner Settings → Kiosk Operating Mode**, choose a mode and click **Save Settings**:

- **Self-Service Mode** *(recommended for unattended kiosks)*:
  - Shows the **QR code** and a **6-digit OTP keypad**.
  - Customers scan, upload & pay on their phone, receive an OTP, and type it into the keypad to print.
- **Owner Mode** *(recommended when staff operate the printer)*:
  - Shows the **QR code** and a live **Print Job Queue**.
  - Paid jobs appear automatically; click **Print** for each customer.

### Filtering the Owner Mode Print Queue by Date

The Print Queue header includes a date filter:

- **Today** *(default)*: Shows only today's jobs.
- **All**: Shows all saved jobs with timestamps.
- **Date Picker**: Select any past date to view jobs from that day.
- The counter on the right shows matching job count; **Refresh** reloads the queue.

---

## 8. Resetting a Forgotten Password

1. Open **Owner Settings** (gear icon, `Ctrl+Shift+S`/`Cmd+Shift+S`, or 5-tap corner).
2. Click **Forgot Password? Reset with 12-word Phrase**.
3. Enter your **12-Word BIP39 Recovery Phrase** (all 12 words in order, space-separated).
4. Enter a **New Owner Password** (minimum 6 characters) and click **Reset Password**.
5. Sign in with your new password.

---

## 9. Installing App Updates

JetPrint checks for updates on startup:

1. If an update is available, an **Update vX.Y.Z** button appears in the header.
2. Open **Owner Settings** and unlock with your password.
3. An **"Update Available Version X.Y.Z"** banner appears at the top.
4. Click **Install Update & Restart**. JetPrint downloads, verifies, installs, and restarts automatically.
5. If prompted with **Existing Data Detected** after restart, choose **Keep Previous Data**.

---

## 10. Troubleshooting

| Issue | How to Fix |
|---|---|
| **Customer phone cannot open QR code** | Set **Cloud Relay URL** to a public `https://` URL (for cellular) or your LAN IP (`http://192.168.x.x:3000` for same-Wi-Fi testing) — not `localhost`. |
| **Header shows `Connecting...` or `Relay Offline`** | Check your internet, confirm the Cloud Relay server is running, verify **Cloud Relay URL** in Owner Settings, and click **Save Settings**. |
| **Printer not listed or fails to print** | Confirm the printer is on, connected, and added in OS settings (macOS Printers & Scanners / Windows Printers & scanners / Linux CUPS), then reselect it in **Owner Settings → Default Printer**. |
| **Prompted with "Existing Data Detected" after reinstall** | Choose **Keep Previous Data** to keep your settings and history, or **Start Fresh** to wipe and re-run setup. |
| **Forgot Owner Password** | Click **Forgot Password? Reset with 12-word Phrase** in the Owner Authentication modal and enter your recovery phrase. |
