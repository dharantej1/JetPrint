# JetPrint Owner Setup Guide

Welcome to **JetPrint Kiosk**! This guide walks you through setting up and running JetPrint in your shop—no technical background required.

---

## 1. Installing & Launching JetPrint Kiosk

1. Download the JetPrint installer for your computer (Windows `.exe`/`.msi`, macOS `.dmg`, or Linux `.AppImage`/`.deb`) from your release page and run the installer.
2. Connect and power on your shop printer, and make sure it is added in your computer's system printer settings.
3. Open **JetPrint Kiosk**. It launches in fullscreen mode ready for customers.

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
   - Enter the web address of your JetPrint Cloud Relay server (for example, `https://relay.yourshop.com` or `http://localhost:3000` for local testing).
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
