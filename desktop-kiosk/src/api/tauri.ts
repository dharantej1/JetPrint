import { getVersion } from "@tauri-apps/api/app";
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

export async function cancelJob(jobId: string): Promise<PrintJob> {
  return invoke<PrintJob>("cancel_job", { jobId });
}

export async function listJobs(
  limit?: number,
  date?: string
): Promise<PrintJob[]> {
  return invoke<PrintJob[]>("list_jobs", { limit, date });
}

export async function connectRelay(relayUrl?: string): Promise<KioskState> {
  return invoke<KioskState>("connect_relay", { relayUrl });
}

export async function resetMachineIdentity(): Promise<KioskState> {
  return invoke<KioskState>("reset_machine_identity");
}

export async function keepExistingData(): Promise<KioskState> {
  return invoke<KioskState>("keep_existing_data");
}

export async function resetInstallationData(): Promise<KioskState> {
  return invoke<KioskState>("reset_installation_data");
}

export async function pickStorageFolder(): Promise<string | null> {
  return invoke<string | null>("pick_storage_folder");
}

export async function setStoragePath(path: string): Promise<KioskState> {
  return invoke<KioskState>("set_storage_path", { path });
}

export function resolveStoragePreviewPath(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return "";
  const parts = trimmed.split(/[\\/]+/).filter(Boolean);
  if (parts[parts.length - 1] === "JetPrint KIOSK") {
    return trimmed;
  }
  const sep = trimmed.includes("\\") && !trimmed.includes("/") ? "\\" : "/";
  return `${trimmed}${sep}JetPrint KIOSK`;
}

export async function getLogs(limit?: number): Promise<string[]> {
  return invoke<string[]>("get_logs", { limit });
}

export async function clearLogs(): Promise<void> {
  return invoke<void>("clear_logs");
}

export async function openLogsWindow(): Promise<void> {
  return invoke<void>("open_logs_window");
}

export async function isFullscreen(): Promise<boolean> {
  return invoke<boolean>("is_fullscreen");
}

export async function toggleFullscreen(): Promise<boolean> {
  return invoke<boolean>("toggle_fullscreen");
}

export async function setFullscreen(fullscreen: boolean): Promise<void> {
  return invoke<void>("set_fullscreen", { fullscreen });
}

export interface UpdateCheckResult {
  update: Update | null;
  error: string | null;
}

export async function getAppVersion(): Promise<string> {
  return getVersion();
}

export async function checkForAppUpdate(timeoutMs = 25000): Promise<UpdateCheckResult> {
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error("Update server took too long to respond. Please check your network connection.")),
        timeoutMs + 3000
      );
    });

    const update = await Promise.race([
      check({
        timeout: timeoutMs,
        headers: {
          "User-Agent": "JetPrint-Desktop-Kiosk",
          "Accept": "application/json",
        },
      }),
      timeoutPromise,
    ]);

    return { update, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
    console.warn("Updater check failed:", err);
    return {
      update: null,
      error: message || "Failed to check for updates.",
    };
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
