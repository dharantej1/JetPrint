import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type {
  CompleteFirstRunResult,
  KioskState,
  PrintJob,
  PrintResult,
  PrinterInfo,
  RelayStatusEvent,
  UpdateSettingsInput,
} from "../types";

export async function getKioskState(): Promise<KioskState> {
  return invoke<KioskState>("get_kiosk_state");
}

export async function completeFirstRun(
  password: string
): Promise<CompleteFirstRunResult> {
  return invoke<CompleteFirstRunResult>("complete_first_run", { password });
}

export async function verifyOwnerPassword(password: string): Promise<boolean> {
  return invoke<boolean>("verify_owner_password", { password });
}

export async function resetPasswordWithPhrase(
  phrase: string,
  newPassword: string
): Promise<void> {
  return invoke<void>("reset_password_with_phrase", {
    phrase,
    newPassword,
  });
}

export async function updateSettings(
  settings: UpdateSettingsInput
): Promise<KioskState> {
  return invoke<KioskState>("update_settings", { settings });
}

export async function listPrinters(): Promise<PrinterInfo[]> {
  return invoke<PrinterInfo[]>("list_printers");
}

export async function verifyOtpAndPrint(otp: string): Promise<PrintResult> {
  return invoke<PrintResult>("verify_otp_and_print", { otp });
}

export async function listJobs(limit?: number): Promise<PrintJob[]> {
  return invoke<PrintJob[]>("list_jobs", { limit });
}

export async function connectRelay(relayUrl?: string): Promise<KioskState> {
  return invoke<KioskState>("connect_relay", { relayUrl });
}

export async function checkForAppUpdate(): Promise<Update | null> {
  try {
    return await check();
  } catch (err) {
    console.warn("Updater check failed:", err);
    return null;
  }
}

export async function installUpdateAndRelaunch(update: Update): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}

export async function listenKioskEvents(handlers: {
  onJobReceived?: (job: PrintJob) => void;
  onRelayStatus?: (event: RelayStatusEvent) => void;
}): Promise<UnlistenFn[]> {
  const unlisteners: UnlistenFn[] = [];
  if (handlers.onJobReceived) {
    unlisteners.push(
      await listen<PrintJob>("job-received", (event) => {
        handlers.onJobReceived?.(event.payload);
      })
    );
  }
  if (handlers.onRelayStatus) {
    unlisteners.push(
      await listen<RelayStatusEvent>("relay-status", (event) => {
        handlers.onRelayStatus?.(event.payload);
      })
    );
  }
  return unlisteners;
}
