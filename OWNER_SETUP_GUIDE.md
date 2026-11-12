# JetPrint Owner Setup Guide

Welcome to **JetPrint Kiosk**! This guide walks you through installing, setting up, and running JetPrint in your shop—no technical background required.

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

Download the installer for your shop computer from the GitHub Releases page, connect your printer, and launch **JetPrint Kiosk** (it opens in fullscreen mode ready for customers).

### macOS (Apple Silicon M1–M4 & Intel)

1. **Download the right `.dmg`**:
   - For **Apple Silicon** Macs (M1, M2, M3, M4): download the **`aarch64`** `.dmg`.
   - For **Intel** Macs: download the **`x64`** `.dmg`.
2. **Install**:
   - Double-click the `.dmg` file to open it, then drag **JetPrint** into your **Applications** folder.
3. **If macOS Gatekeeper blocks the first launch** *(common if the build is not Apple-notarized)*:
   - Open **Finder → Applications**, **right-click** (or Control-click) **JetPrint**, and choose **Open**, then click **Open** in the dialog.
   - Alternatively, open **System Settings → Privacy & Security**, scroll to the Security section, and click **Open Anyway** next to JetPrint.
4. **Add & test your shop printer**:
   - Open **System Settings → Printers & Scanners**, make sure your printer is added and online, and print a test page (set it as the default printer if desired).
5. **Launch & verify**:
   - Open **JetPrint** from **Applications**. Complete the [3-Step First-Run Setup Wizard](#3-first-run-setup-wizard-3-steps) (or choose an option if prompted for [existing data](#2-reinstalling-or-upgrading-start-fresh-vs-keep-previous-data)), then check that the top-right status pill shows **Relay Online** (green dot).

### Windows (10 / 11)

1. **Download & run the installer**:
   - Download the **`.exe`** (NSIS) or **`.msi`** installer from the release page and double-click it to install.
2. **If Windows SmartScreen warns you** *(common for unsigned builds)*:
   - Click **More info**, then click **Run anyway** to proceed with installation.
3. **Add & test your shop printer**:
   - Open **Settings → Bluetooth & devices → Printers & scanners**, confirm your printer is listed and ready, and print a test page (or set it as default).
4. **Launch & verify**:
   - Open **JetPrint** from the Start Menu or Desktop shortcut. Complete the [3-Step First-Run Setup Wizard](#3-first-run-setup-wizard-3-steps) (or choose an option if prompted for [existing data](#2-reinstalling-or-upgrading-start-fresh-vs-keep-previous-data)), then verify **Relay Online** in the top-right header.

### Linux (Ubuntu / Debian & AppImage)

1. **Install via `.deb` or `.AppImage`**:
   - **`.deb` (Ubuntu / Debian)**:
     ```bash
     sudo apt update
     sudo apt install ./JetPrint_*.deb
     ```
   - **`.AppImage`**: Make the file executable and run it:
     ```bash
     chmod +x JetPrint_*.AppImage
     ./JetPrint_*.AppImage
     ```
   - *Note:* If using the `.AppImage` on a minimal system, ensure `libwebkit2gtk-4.1-0` and `libcups2` are installed (`sudo apt install libwebkit2gtk-4.1-0 libcups2`).
2. **Add & test your shop printer**:
   - Add your printer in **System Settings → Printers** or via the CUPS web interface at `http://localhost:631`, and print a test page.
3. **Launch & verify**:
   - Launch **JetPrint** from your application menu (or run the AppImage). Complete the [3-Step First-Run Setup Wizard](#3-first-run-setup-wizard-3-steps) (or choose an option if prompted for [existing data](#2-reinstalling-or-upgrading-start-fresh-vs-keep-previous-data)), then verify **Relay Online** in the top-right header.

---

## 2. Reinstalling or Upgrading: "Start Fresh" vs "Keep Previous Data"

JetPrint stores your shop's local database (`jetprint.db`—containing your Machine ID, Owner Password, recovery phrase, printer/pricing settings, and print job history) in your computer's application data folder so it is preserved across app updates and reinstalls.

When you install or launch a new JetPrint build on a computer that already has existing JetPrint data, an **Existing Data Detected** prompt appears automatically before the kiosk starts, showing your saved **Machine ID** and the number of saved **print job(s)**:

- **Keep Previous Data** *(recommended for normal upgrades or reinstalls on the same shop PC)*:
  - Keeps your existing Machine ID, Owner Password, 12-word recovery phrase, printer/pricing/relay settings, and print job history, and resumes the kiosk immediately.
- **Start Fresh (Remove Previous Data)** *(recommended when resetting a test machine or setting up a new shop)*:
  - Permanently deletes all previous print job history and temporary job files, clears old settings and credentials, generates a brand-new Machine ID, and launches the **3-Step First-Run Setup Wizard** from scratch.
  - Because this cannot be undone, JetPrint asks you to confirm by clicking **Yes, Remove Data & Start Fresh** before erasing previous data.

---

## 3. First-Run Setup Wizard (3 Steps)

The first time you open JetPrint Kiosk (or after choosing **Start Fresh**), the **3-Step First-Run Setup Wizard** appears automatically:

1. **Step 1 of 3 — Create Owner Password**:
   - Your Owner Password protects **Owner Settings** and **Owner Mode** so customers cannot change pricing, printer settings, or access the print queue.
   - Enter an **Admin Password** (at least 6 characters) and re-enter it under **Confirm Admin Password**.
   - Click **Continue & Generate Recovery Phrase**.
2. **Step 2 of 3 — Save Your 12-Word Recovery Phrase**:
   - JetPrint generates a unique **12-word recovery phrase** (numbered 1 to 12).
   - **Write these 12 words down on paper in exact order** and keep them in a safe place (or click **Copy 12-Word Phrase** to store them in a secure password manager).
   - **Important:** This 12-word phrase is the **only way** to reset your Owner Password if you ever forget it.
   - Check the box **"I have saved my recovery phrase"** and click **Continue to Printer & Relay Setup**.
3. **Step 3 of 3 — Configure Printer, Pricing & Cloud Relay**:
   - **Default Printer**: Select your shop printer from the dropdown (or leave it on **System Default Printer**).
   - **Per-Page Pricing (in ₹)**: Set your **B&W Price per Page** (default `2.00`) and **Color Price per Page** (default `10.00`).
   - **Cloud Relay URL**: Enter the web address of your JetPrint Cloud Relay server (defaults to `http://localhost:3000` for local testing; use your public `https://` URL in production, or your computer's LAN IP such as `http://192.168.1.50:3000` for same-Wi-Fi phone testing).
   - Click **Save & Launch Kiosk** to save your settings and connect to the Cloud Relay—or click **Skip for Now** to launch immediately and configure these later in **Owner Settings** (accessible anytime via `Ctrl+Shift+S` / `Cmd+Shift+S`, the top-right gear icon, or tapping the bottom-right corner 5 times).

---

## 4. Understanding the Connection Status Pill

Look at the **status pill** in the top-right header of the kiosk screen to see your Cloud Relay connection state at a glance:

| Status Pill | Indicator | Meaning & Action |
|---|---|---|
| **`Relay Online`** | Green dot | **Connected.** The kiosk is connected to the Cloud Relay, pricing is synced, and customer print jobs will arrive automatically. |
| **`Connecting...`** | Amber/yellow dot | **Connecting or reconnecting.** JetPrint is establishing a connection to the Cloud Relay. Wait a few seconds; if it stays on `Connecting...`, check your internet connection or Cloud Relay URL. |
| **`Relay Offline`** | Red dot (red-tinted pill) | **Disconnected or unreachable.** The kiosk cannot reach the Cloud Relay (for example, the relay server is down, there is no internet, or the Cloud Relay URL has a typo). Open **Owner Settings**, check **Cloud Relay URL**, and click **Save Settings** to reconnect. |

---

## 5. Opening Owner Settings

To access shop settings at any time without letting customers in:

- Click the **gear icon** in the top-right corner of the screen, **or**
- Press **`Ctrl + Shift + S`** (Windows/Linux) or **`Cmd + Shift + S`** (macOS), **or**
- Tap the **bottom-right corner** of the screen **5 times** quickly.

Enter your **Owner Password** and click **Unlock Settings**.

---

## 6. Configuring Relay URL, Default Printer, and Per-Page Pricing

Inside **Owner Settings**, you can update your kiosk configuration at any time:

1. **Default Printer**:
   - Choose your shop printer from the **Default Printer** dropdown (or leave it on **System Default Printer**).
2. **Per-Page Pricing (in ₹)**:
   - Set **B&W Price per Page** (default `2.00`).
   - Set **Color Price per Page** (default `10.00`).
   - Whenever you save new prices, they automatically sync to the Cloud Relay so customers see the exact price on their phone before paying.
3. **Cloud Relay URL**:
   - Enter the web address of your JetPrint Cloud Relay server (for example, `https://relay.yourshop.com`).
   - **Important:** For customer phones on cellular data or outside your Wi-Fi, this **must** be a public `https://` Cloud Relay URL (provided by your administrator/host). For local testing on the same Wi-Fi, use your computer's local network IP (such as `http://192.168.1.50:3000`) instead of `localhost` so phones can open the QR code link.
4. Click **Save Settings**.
   - Check the top-right status pill on the main screen: **Relay Online** (green dot) confirms the kiosk is connected and ready to receive jobs.

---

## 7. Switching Between Self-Service Mode and Owner Mode

In **Owner Settings**, under **Kiosk Operating Mode**, you can switch between two modes and click **Save Settings**:

- **Self-Service Mode** *(recommended for unattended kiosks)*:
  - Shows the **QR code** on the left and the **6-digit OTP keypad** on the right.
  - Customers scan the QR code, upload & pay on their phone, receive a 6-digit OTP, and type it into the kiosk keypad to print immediately.
- **Owner Mode** *(recommended when staff operate the printer)*:
  - Shows the **QR code** on the left and a live **Print Job Queue** on the right.
  - Paid jobs appear in the queue automatically so you or your staff can click **Print** directly for each customer.

### Filtering the Owner Mode Print Queue by Date

In **Owner Mode**, the Print Queue header includes a date filter bar so you can quickly find today's jobs or review past days:

- **Today** *(default)*: Shows only print jobs received today.
- **All**: Shows all saved print jobs across every date (each job's timestamp includes the date and time).
- **Date Picker (Calendar)**: Click the calendar input to pick any specific past date (up to today) and view only the jobs from that day.
- The counter on the right displays the total matching jobs (`N job` / `N jobs`), and the **Refresh** button reloads the queue.

---

## 8. Resetting a Forgotten Password

If you forget your Owner Password:

1. Open **Owner Settings** (gear icon, `Ctrl+Shift+S`/`Cmd+Shift+S`, or 5-tap corner).
2. On the **Owner Authentication** screen, click **Forgot Password? Reset with 12-word Phrase**.
3. Type your **12-Word BIP39 Recovery Phrase** (all 12 words separated by spaces, in order).
4. Enter a **New Owner Password** (minimum 6 characters) and click **Reset Password**.
5. Sign in with your new password.

---

## 9. Installing App Updates

JetPrint automatically checks for new versions when it starts:

1. If a new version is available, an **Update vX.Y.Z** button appears in the top-right header.
2. Open **Owner Settings** and unlock with your password.
3. At the top of the settings window, you will see an **"Update Available Version X.Y.Z"** banner.
4. Click **Install Update & Restart**. JetPrint will download, verify, and install the update, then restart automatically.
5. On launch after updating, if prompted with **Existing Data Detected**, choose **Keep Previous Data** to continue with your existing settings and job history.

---

## 10. Troubleshooting

| Issue | How to Fix |
|---|---|
| **Customer phone cannot open QR code** | Ensure **Cloud Relay URL** in Owner Settings is a public `https://` URL (for cellular data) or your computer's LAN IP (`http://192.168.x.x:3000` for same-Wi-Fi testing), not `localhost`. |
| **Header shows `Connecting...` or `Relay Offline` instead of `Relay Online`** | Check your internet connection, confirm the Cloud Relay server is running, verify the **Cloud Relay URL** in **Owner Settings** has no typos, and click **Save Settings** to reconnect. |
| **Printer not listed or fails to print** | Confirm the printer is powered on, connected, and added in your OS printer settings (macOS Printers & Scanners / Windows Printers & scanners / Linux CUPS), then reopen **Owner Settings** and select it under **Default Printer**. |
| **Prompted with "Existing Data Detected" after reinstalling** | Choose **Keep Previous Data** to preserve your Machine ID, password, settings, and job history, or **Start Fresh (Remove Previous Data)** to wipe old data and run the 3-step setup wizard again. |
| **Forgot Owner Password** | Click **Forgot Password? Reset with 12-word Phrase** in the Owner Authentication modal and enter the 12-word recovery phrase saved during First-Run Setup. |
