# JetPrint Owner Setup Guide

Welcome to **JetPrint Kiosk**! This guide walks you through setting up and running JetPrint in your shop—no technical background required.

> For developer & hosting documentation, see [`DEVELOPER_DOCS.md`](DEVELOPER_DOCS.md) and [`README.md`](README.md).

## Table of Contents

- [1. Installing & Launching JetPrint Kiosk](#1-installing--launching-jetprint-kiosk)
  - [macOS (Apple Silicon M1–M4 & Intel)](#macos-apple-silicon-m1m4--intel)
  - [Windows (10 / 11)](#windows-10--11)
  - [Linux (Ubuntu / Debian & AppImage)](#linux-ubuntu--debian--appimage)
- [2. First-Run Setup (Owner Password & 12-Word Recovery Phrase)](#2-first-run-setup-owner-password--12-word-recovery-phrase)
- [3. Opening Owner Settings](#3-opening-owner-settings)
- [4. Configuring Relay URL, Default Printer, and Per-Page Pricing](#4-configuring-relay-url-default-printer-and-per-page-pricing)
- [5. Switching Between Self-Service Mode and Owner Mode](#5-switching-between-self-service-mode-and-owner-mode)
- [6. Resetting a Forgotten Password](#6-resetting-a-forgotten-password)
- [7. Installing App Updates](#7-installing-app-updates)
- [8. Troubleshooting](#8-troubleshooting)

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
   - Open **JetPrint** from **Applications**. After completing First-Run Setup, check that the top-right status pill shows **Relay Online** (green dot) and your printer appears in **Owner Settings → Default Printer**.

### Windows (10 / 11)

1. **Download & run the installer**:
   - Download the **`.exe`** (NSIS) or **`.msi`** installer from the release page and double-click it to install.
2. **If Windows SmartScreen warns you** *(common for unsigned builds)*:
   - Click **More info**, then click **Run anyway** to proceed with installation.
3. **Add & test your shop printer**:
   - Open **Settings → Bluetooth & devices → Printers & scanners**, confirm your printer is listed and ready, and print a test page (or set it as default).
4. **Launch & verify**:
   - Open **JetPrint** from the Start Menu or Desktop shortcut. After First-Run Setup, verify **Relay Online** in the top-right header and select your printer in **Owner Settings → Default Printer**.

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
   - Launch **JetPrint** from your application menu (or run the AppImage). After First-Run Setup, verify **Relay Online** in the top-right header and confirm your printer is listed in **Owner Settings → Default Printer**.

---

## 2. First-Run Setup (Owner Password & 12-Word Recovery Phrase)

The very first time you open JetPrint Kiosk, the **JetPrint Kiosk Setup** wizard appears automatically:

1. **Create an Owner Password**:
   - Enter an **Admin Password** (at least 6 characters) and re-enter it under **Confirm Admin Password**.
   - Click **Continue & Generate Recovery Phrase**.
2. **Save Your 12-Word Recovery Phrase**:
   - JetPrint displays a **12-word recovery phrase** (numbered 1 to 12).
   - **Write these 12 words down on paper in exact order** and keep them in a safe place (or click **Copy 12-Word Phrase** to store in a secure password manager).
   - **Important:** This 12-word phrase is the **only way** to reset your owner password if you ever forget it.
3. Check the box **"I have saved my recovery phrase"** and click **Finish Setup & Launch Kiosk**.

---

## 3. Opening Owner Settings

To access shop settings at any time without letting customers in:

- Click the **gear icon** in the top-right corner of the screen, **or**
- Press **`Ctrl + Shift + S`** (Windows/Linux) or **`Cmd + Shift + S`** (macOS), **or**
- Tap the **bottom-right corner** of the screen **5 times** quickly.

Enter your **Owner Password** and click **Unlock Settings**.

---

## 4. Configuring Relay URL, Default Printer, and Per-Page Pricing

Inside **Owner Settings**:

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

## 5. Switching Between Self-Service Mode and Owner Mode

In **Owner Settings**, under **Kiosk Operating Mode**, you can switch between two modes and click **Save Settings**:

- **Self-Service Mode** *(recommended for unattended kiosks)*:
  - Shows the **QR code** on the left and the **6-digit OTP keypad** on the right.
  - Customers scan the QR code, upload & pay on their phone, receive a 6-digit OTP, and type it into the kiosk keypad to print immediately.
- **Owner Mode** *(recommended when staff operate the printer)*:
  - Shows the **QR code** on the left and a live **Print Job Queue** on the right.
  - Paid jobs appear in the queue automatically so you or your staff can click **Print** directly for each customer.

---

## 6. Resetting a Forgotten Password

If you forget your Owner Password:

1. Open **Owner Settings** (gear icon, `Ctrl+Shift+S`/`Cmd+Shift+S`, or 5-tap corner).
2. On the **Owner Authentication** screen, click **Forgot Password? Reset with 12-word Phrase**.
3. Type your **12-Word BIP39 Recovery Phrase** (all 12 words separated by spaces, in order).
4. Enter a **New Owner Password** (minimum 6 characters) and click **Reset Password**.
5. Sign in with your new password.

---

## 7. Installing App Updates

JetPrint automatically checks for new versions when it starts:

1. If a new version is available, an **Update vX.Y.Z** button appears in the top-right header.
2. Open **Owner Settings** and unlock with your password.
3. At the top of the settings window, you will see an **"Update Available Version X.Y.Z"** banner.
4. Click **Install Update & Restart**. JetPrint will download, verify, and install the update, then restart automatically.

---

## 8. Troubleshooting

| Issue | How to Fix |
|---|---|
| **Customer phone cannot open QR code** | Ensure **Cloud Relay URL** in Owner Settings is a public `https://` URL (for cellular data) or your computer's LAN IP (`http://192.168.x.x:3000` for same-Wi-Fi testing), not `localhost`. |
| **Header shows "Connecting..." instead of "Relay Online"** | Check your internet connection, verify the **Cloud Relay URL** in Owner Settings has no typos, and click **Save Settings** to reconnect. |
| **Printer not listed or fails to print** | Confirm the printer is powered on, connected, and added in your OS printer settings (macOS Printers & Scanners / Windows Printers & scanners / Linux CUPS), then reopen **Owner Settings** and select it under **Default Printer**. |
| **Forgot Owner Password** | Click **Forgot Password? Reset with 12-word Phrase** in the Owner Authentication modal and enter the 12-word recovery phrase saved during First-Run Setup. |
