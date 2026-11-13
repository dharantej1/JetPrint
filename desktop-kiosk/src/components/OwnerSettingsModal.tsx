import React, { useEffect, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import {
  X,
  Lock,
  Settings,
  DownloadCloud,
  RefreshCw,
  Save,
  Loader2,
  KeyRound,
  Printer,
  CheckCircle2,
  FolderOpen,
  FileText,
  Maximize,
  Minimize,
  Monitor,
} from "lucide-react";
import type { KioskMode, KioskState, PrintJob, PrinterInfo } from "../types";
import {
  type UpdateCheckResult,
  connectRelay,
  installUpdateAndRelaunch,
  isFullscreen as checkIsFullscreen,
  listJobs,
  listPrinters,
  openLogsWindow,
  pickStorageFolder,
  resetMachineIdentity,
  resetPasswordWithPhrase,
  resolveStoragePreviewPath,
  setStoragePath,
  toggleFullscreen,
  updateSettings,
  verifyOtpAndPrint,
  verifyOwnerPassword,
} from "../api/tauri";

interface OwnerSettingsModalProps {
  kioskState: KioskState;
  currentVersion: string;
  availableUpdate: Update | null;
  updateCheckError: string | null;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onCheckForUpdates: () => Promise<UpdateCheckResult>;
  onClose: () => void;
  onStateUpdated: (next: KioskState) => void;
}

export const OwnerSettingsModal: React.FC<OwnerSettingsModalProps> = ({
  kioskState,
  currentVersion,
  availableUpdate,
  updateCheckError,
  isFullscreen: isFullscreenProp,
  onToggleFullscreen,
  onCheckForUpdates,
  onClose,
  onStateUpdated,
}) => {
  const [unlocked, setUnlocked] = useState(false);
  const [view, setView] = useState<"login" | "reset" | "settings">("login");
  const [isFullscreenLocal, setIsFullscreenLocal] = useState(isFullscreenProp ?? false);

  useEffect(() => {
    if (isFullscreenProp !== undefined) {
      setIsFullscreenLocal(isFullscreenProp);
    } else {
      checkIsFullscreen().then(setIsFullscreenLocal).catch(() => {});
    }
  }, [isFullscreenProp]);

  const handleToggleFullscreen = async () => {
    if (onToggleFullscreen) {
      onToggleFullscreen();
      return;
    }
    try {
      const next = await toggleFullscreen();
      setIsFullscreenLocal(next);
    } catch (err) {
      console.error("Failed to toggle fullscreen:", err);
    }
  };

  // Login / Reset state
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSuccess, setAuthSuccess] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // Settings form state
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [defaultPrinter, setDefaultPrinter] = useState<string>(
    kioskState.defaultPrinter ?? ""
  );
  const [bwRupees, setBwRupees] = useState<string>(
    (kioskState.bwPricePaise / 100).toFixed(2)
  );
  const [colorRupees, setColorRupees] = useState<string>(
    (kioskState.colorPricePaise / 100).toFixed(2)
  );
  const [kioskMode, setKioskMode] = useState<KioskMode>(kioskState.kioskMode);
  const [relayUrl, setRelayUrl] = useState<string>(kioskState.relayUrl);
  const [storageFolder, setStorageFolder] = useState<string>(
    kioskState.storagePath || ""
  );
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");

  // Updater state
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [checkedUpToDate, setCheckedUpToDate] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(updateCheckError);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState("");

  useEffect(() => {
    setCheckError(updateCheckError);
  }, [updateCheckError]);

  // Recent jobs (shown in Owner Mode)
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [printingOtp, setPrintingOtp] = useState<string | null>(null);

  useEffect(() => {
    if (!unlocked) return;
    listPrinters()
      .then((list) => setPrinters(list))
      .catch((err) => console.warn("Failed to load printers:", err));
    listJobs()
      .then((list) => setJobs(list))
      .catch((err) => console.warn("Failed to load jobs:", err));
  }, [unlocked]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      const ok = await verifyOwnerPassword(password);
      if (ok) {
        setUnlocked(true);
        setView("settings");
      } else {
        setAuthError("Incorrect password.");
      }
    } catch (err) {
      setAuthError(typeof err === "string" ? err : "Verification failed.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setAuthSuccess("");
    if (newPassword.length < 6) {
      setAuthError("New password must be at least 6 characters.");
      return;
    }
    setAuthLoading(true);
    try {
      await resetPasswordWithPhrase(phrase.trim(), newPassword);
      setAuthSuccess("Password reset successfully. You can now sign in.");
      setPhrase("");
      setNewPassword("");
      setPassword("");
      setView("login");
    } catch (err) {
      setAuthError(typeof err === "string" ? err : "Invalid 12-word recovery phrase.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError("");
    setSaveMessage("");
    const bwPaise = Math.max(0, Math.round(parseFloat(bwRupees || "0") * 100));
    const colorPaise = Math.max(0, Math.round(parseFloat(colorRupees || "0") * 100));

    if (Number.isNaN(bwPaise) || Number.isNaN(colorPaise)) {
      setSaveError("Please enter valid pricing amounts.");
      return;
    }

    setSaving(true);
    try {
      let updated = await updateSettings({
        defaultPrinter: defaultPrinter || undefined,
        bwPricePaise: bwPaise,
        colorPricePaise: colorPaise,
        kioskMode,
        relayUrl: relayUrl.trim(),
      });
      const trimmedStorage = storageFolder.trim();
      if (
        trimmedStorage &&
        resolveStoragePreviewPath(trimmedStorage) !== kioskState.storagePath
      ) {
        updated = await setStoragePath(trimmedStorage);
        setStorageFolder(updated.storagePath);
      }
      onStateUpdated(updated);
      setSaveMessage("Settings saved.");
      if (relayUrl.trim() !== kioskState.relayUrl) {
        const reconnected = await connectRelay(relayUrl.trim()).catch(() => null);
        if (reconnected) onStateUpdated(reconnected);
      }
    } catch (err) {
      setSaveError(typeof err === "string" ? err : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleCheckForUpdates = async () => {
    setCheckingUpdates(true);
    setCheckedUpToDate(false);
    setCheckError(null);
    setUpdateError("");
    const result = await onCheckForUpdates();
    setCheckingUpdates(false);
    if (result.error) {
      setCheckError(result.error);
    } else if (!result.update) {
      setCheckedUpToDate(true);
    }
  };

  const handleInstallUpdate = async () => {
    if (!availableUpdate) return;
    setUpdateError("");
    setInstallingUpdate(true);
    try {
      await installUpdateAndRelaunch(availableUpdate);
    } catch (err) {
      setUpdateError(
        typeof err === "string" ? err : "Update installation failed."
      );
      setInstallingUpdate(false);
    }
  };

  const handleDirectPrint = async (otp: string) => {
    setPrintingOtp(otp);
    try {
      await verifyOtpAndPrint(otp);
      const updated = await listJobs();
      setJobs(updated);
    } catch (err) {
      setSaveError(typeof err === "string" ? err : "Print failed.");
    } finally {
      setPrintingOtp(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal-card ${unlocked ? "wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title">
            {unlocked ? <Settings size={20} color="#818cf8" /> : <Lock size={20} color="#818cf8" />}
            <span>
              {view === "login"
                ? "Owner Authentication"
                : view === "reset"
                ? "Reset Owner Password"
                : "Owner Settings"}
            </span>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {view === "login" && (
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="form-group">
              <label className="form-label">Owner Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
                autoFocus
                required
              />
            </div>

            {authError && <p className="error-text">{authError}</p>}
            {authSuccess && <p className="success-text">{authSuccess}</p>}

            <button type="submit" className="btn-primary" disabled={authLoading}>
              {authLoading ? <Loader2 size={16} className="spin" /> : <Lock size={16} />}
              <span>Unlock Settings</span>
            </button>

            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setAuthError("");
                setAuthSuccess("");
                setView("reset");
              }}
            >
              Forgot Password? Reset with 12-word Phrase
            </button>
          </form>
        )}

        {view === "reset" && (
          <form onSubmit={handleResetPassword} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="form-group">
              <label className="form-label">12-Word BIP39 Recovery Phrase</label>
              <textarea
                rows={3}
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder="word1 word2 word3 ... word12"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">New Owner Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                required
              />
            </div>

            {authError && <p className="error-text">{authError}</p>}

            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setAuthError("");
                  setView("login");
                }}
              >
                Back to Login
              </button>
              <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={authLoading}>
                {authLoading ? <Loader2 size={16} className="spin" /> : <KeyRound size={16} />}
                <span>Reset Password</span>
              </button>
            </div>
          </form>
        )}

        {view === "settings" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 10,
                background: "rgba(15, 23, 42, 0.55)",
                border: "1px solid rgba(148, 163, 184, 0.16)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span className="form-label" style={{ marginBottom: 0 }}>App Version</span>
                  <span style={{ fontSize: 13, color: "#cbd5e1", fontFamily: "monospace" }}>
                    {currentVersion ? `v${currentVersion}` : "Unknown"}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleCheckForUpdates}
                  disabled={checkingUpdates || installingUpdate}
                >
                  {checkingUpdates ? (
                    <>
                      <Loader2 size={15} className="spin" />
                      <span>Checking...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw size={15} />
                      <span>Check for Updates</span>
                    </>
                  )}
                </button>
              </div>

              {availableUpdate && (
                <div className="update-banner">
                  <div className="update-info">
                    <DownloadCloud size={20} color="#818cf8" />
                    <span>Update Available: Version {availableUpdate.version}</span>
                  </div>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleInstallUpdate}
                    disabled={installingUpdate}
                  >
                    {installingUpdate ? (
                      <>
                        <Loader2 size={15} className="spin" />
                        <span>Installing...</span>
                      </>
                    ) : (
                      <span>Install Update &amp; Restart</span>
                    )}
                  </button>
                </div>
              )}

              {!availableUpdate && !checkingUpdates && checkedUpToDate && !checkError && (
                <p className="success-text" style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
                  <CheckCircle2 size={15} /> Up to date
                </p>
              )}

              {checkError && <p className="error-text" style={{ margin: 0 }}>{checkError}</p>}
              {updateError && <p className="error-text" style={{ margin: 0 }}>{updateError}</p>}
            </div>

            {/* Window & Display Section */}
            <div className="display-card">
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span className="form-label" style={{ marginBottom: 0, display: "flex", alignItems: "center", gap: 6 }}>
                  <Monitor size={15} /> Window &amp; Display
                </span>
                <span style={{ fontSize: 13, color: "#94a3b8" }}>
                  {isFullscreenLocal
                    ? "Currently running in Fullscreen mode"
                    : "Currently running in Normal Windowed mode"}
                </span>
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleToggleFullscreen}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                {isFullscreenLocal ? (
                  <>
                    <Minimize size={15} />
                    <span>Exit Fullscreen</span>
                  </>
                ) : (
                  <>
                    <Maximize size={15} />
                    <span>Enter Fullscreen</span>
                  </>
                )}
              </button>
            </div>

            <form onSubmit={handleSaveSettings} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="form-group">
                <label className="form-label">Kiosk Operating Mode</label>
                <div className="mode-toggle">
                  <button
                    type="button"
                    className={`mode-option ${kioskMode === "self_service" ? "active" : ""}`}
                    onClick={() => setKioskMode("self_service")}
                  >
                    Self-Service Mode
                  </button>
                  <button
                    type="button"
                    className={`mode-option ${kioskMode === "owner" ? "active" : ""}`}
                    onClick={() => setKioskMode("owner")}
                  >
                    Owner Mode
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Default Printer</label>
                <select
                  value={defaultPrinter}
                  onChange={(e) => setDefaultPrinter(e.target.value)}
                >
                  <option value="">System Default Printer</option>
                  {printers.map((p) => (
                    <option key={p.systemName || p.name} value={p.name}>
                      {p.name} {p.isDefault ? "(Default)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">B/W Price per Page (₹)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={bwRupees}
                    onChange={(e) => setBwRupees(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Color Price per Page (₹)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={colorRupees}
                    onChange={(e) => setColorRupees(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Cloud Relay URL</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="url"
                    style={{ flex: 1 }}
                    value={relayUrl}
                    onChange={(e) => setRelayUrl(e.target.value)}
                    placeholder="https://relay.example.com"
                    required
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() =>
                      connectRelay(relayUrl.trim())
                        .then((s) => onStateUpdated(s))
                        .catch(() => {})
                    }
                    title="Reconnect to Cloud Relay"
                  >
                    <RefreshCw size={15} />
                    <span>Reconnect</span>
                  </button>
                </div>
                {kioskState.relayAuthError && (
                  <div
                    className="status-banner error"
                    style={{
                      marginTop: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <span>Auth failed: {kioskState.relayAuthError}</span>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() =>
                        resetMachineIdentity()
                          .then((s) => onStateUpdated(s))
                          .catch((err) =>
                            setSaveError(
                              typeof err === "string" ? err : "Failed to re-register machine."
                            )
                          )
                      }
                    >
                      Re-register Machine
                    </button>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Storage Folder</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    style={{ flex: 1 }}
                    value={storageFolder}
                    onChange={(e) => setStorageFolder(e.target.value)}
                    placeholder="Application data folder"
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() =>
                      pickStorageFolder()
                        .then((picked) => {
                          if (picked) setStorageFolder(picked);
                        })
                        .catch(() => {})
                    }
                    title="Browse Storage Folder"
                  >
                    <FolderOpen size={15} />
                    <span>Browse...</span>
                  </button>
                </div>
                <span style={{ fontSize: 12, color: "#64748b", lineHeight: 1.4, wordBreak: "break-all" }}>
                  Stores <code style={{ color: "#94a3b8" }}>jetprint.db</code>,{" "}
                  <code style={{ color: "#94a3b8" }}>jobs/</code>, and{" "}
                  <code style={{ color: "#94a3b8" }}>logs/</code> in{" "}
                  <code style={{ color: "#c7d2fe" }}>
                    {storageFolder.trim()
                      ? resolveStoragePreviewPath(storageFolder)
                      : "JetPrint KIOSK"}
                  </code>
                </span>
              </div>

              {saveError && <p className="error-text">{saveError}</p>}
              {saveMessage && (
                <p className="success-text" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <CheckCircle2 size={15} /> {saveMessage}
                </p>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 12, color: "#64748b" }}>
                  Machine ID: <code style={{ color: "#94a3b8" }}>{kioskState.machineId}</code>
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => openLogsWindow().catch(() => {})}
                  >
                    <FileText size={15} />
                    <span>View Logs</span>
                  </button>
                  <button type="submit" className="btn-primary" disabled={saving}>
                    {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                    <span>Save Settings</span>
                  </button>
                </div>
              </div>
            </form>

            {kioskMode === "owner" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid rgba(148,163,184,0.16)", paddingTop: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="form-label">Recent Print Jobs ({jobs.length})</span>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => listJobs().then(setJobs).catch(() => {})}
                  >
                    Refresh Jobs
                  </button>
                </div>
                <div className="jobs-list">
                  {jobs.length === 0 ? (
                    <span style={{ fontSize: 13, color: "#64748b" }}>No print jobs yet.</span>
                  ) : (
                    jobs.slice(0, 10).map((job) => (
                      <div key={job.id} className="job-row">
                        <div>
                          <strong>OTP {job.otp}</strong>{" "}
                          <span style={{ color: "#94a3b8" }}>
                            • {job.copies}x • {job.color ? "Color" : "B/W"} • {job.status}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ padding: "5px 10px", fontSize: 12 }}
                          disabled={printingOtp === job.otp}
                          onClick={() => handleDirectPrint(job.otp)}
                        >
                          <Printer size={13} />
                          <span>{printingOtp === job.otp ? "Printing..." : "Print"}</span>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
