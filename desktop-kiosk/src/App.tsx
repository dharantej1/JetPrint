import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { Printer, Settings, Wifi, WifiOff, DownloadCloud, Maximize, Minimize } from "lucide-react";
import type { KioskState, PrintJob, RelayStatus } from "./types";
import {
  cancelJob,
  checkForAppUpdate,
  getAppVersion,
  getKioskState,
  isFullscreen as checkIsFullscreen,
  listJobs,
  listenKioskEvents,
  resetMachineIdentity,
  setFullscreen,
  toggleFullscreen,
  verifyOtpAndPrint,
} from "./api/tauri";
import { QrPanel } from "./components/QrPanel";
import { OtpKeypad, type OtpFeedbackStatus } from "./components/OtpKeypad";
import { FirstRunWizard } from "./components/FirstRunWizard";
import { ExistingDataModal } from "./components/ExistingDataModal";
import { OwnerSettingsModal } from "./components/OwnerSettingsModal";
import { OwnerModeQueue, getTodayLocalDate } from "./components/OwnerModeQueue";
import { LogsWindow } from "./components/LogsWindow";

const FALLBACK_STATE: KioskState = {
  machineId: "LOADING",
  relayUrl: "http://localhost:3000",
  qrRelayUrl: "http://localhost:3000",
  bwPricePaise: 200,
  colorPricePaise: 1000,
  defaultPrinter: null,
  kioskMode: "self_service",
  setupComplete: true,
  relayConnected: false,
  relayStatus: "connecting",
  relayMessage: null,
  relayAuthError: null,
  existingDataPrompt: false,
  existingJobCount: 0,
  storagePath: "",
};

const KioskApp: React.FC = () => {
  const [kioskState, setKioskState] = useState<KioskState>(FALLBACK_STATE);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [relayStatus, setRelayStatus] = useState<RelayStatus>("connecting");
  const [relayMessage, setRelayMessage] = useState<string | null>(null);
  const [relayAuthError, setRelayAuthError] = useState<string | null>(null);
  const [reRegistering, setReRegistering] = useState(false);

  // OTP entry state
  const [otp, setOtp] = useState("");
  const [otpStatus, setOtpStatus] = useState<OtpFeedbackStatus>("idle");
  const [otpMessage, setOtpMessage] = useState("");
  const [printedJob, setPrintedJob] = useState<PrintJob | null>(null);

  // Owner mode queue state
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    getTodayLocalDate()
  );
  const [printingJobOtp, setPrintingJobOtp] = useState<string | null>(null);
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);

  // Refs for stable event listener callbacks
  const kioskModeRef = useRef(kioskState.kioskMode);
  kioskModeRef.current = kioskState.kioskMode;
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;

  // Owner modal & updater state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentVersion, setCurrentVersion] = useState("");
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [updateCheckError, setUpdateCheckError] = useState<string | null>(null);

  const handleToggleFullscreen = useCallback(async () => {
    try {
      const next = await toggleFullscreen();
      setIsFullscreen(next);
    } catch (err) {
      console.error("Failed to toggle fullscreen:", err);
    }
  }, []);

  // Check initial fullscreen state and keep in sync with window resize
  useEffect(() => {
    checkIsFullscreen().then(setIsFullscreen).catch(() => {});
    const onResize = () => {
      checkIsFullscreen().then(setIsFullscreen).catch(() => {});
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const runUpdateCheck = useCallback(async () => {
    const result = await checkForAppUpdate();
    setAvailableUpdate(result.update);
    setUpdateCheckError(result.error);
    return result;
  }, []);

  // 5-tap corner trigger tracking
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<number | null>(null);

  const refreshJobs = useCallback(async (dateOverride?: string | null) => {
    const date =
      dateOverride === undefined ? selectedDateRef.current : dateOverride;
    try {
      const nextJobs = await listJobs(undefined, date ?? undefined);
      setJobs(nextJobs);
    } catch {
      // ignore transient errors
    }
  }, []);

  const loadState = useCallback(async () => {
    try {
      const state = await getKioskState();
      setKioskState(state);
      setRelayStatus(state.relayStatus);
      setRelayMessage(state.relayMessage);
      setRelayAuthError(state.relayAuthError);
      if (state.kioskMode === "owner") {
        await refreshJobs();
      }
      setLoadError("");
    } catch (err) {
      setLoadError(
        typeof err === "string"
          ? err
          : "Unable to connect to JetPrint backend."
      );
    } finally {
      setLoaded(true);
    }
  }, [refreshJobs]);

  useEffect(() => {
    let active = true;
    let unlisteners: Array<() => void> = [];

    listenKioskEvents({
      onJobReceived: () => {
        if (kioskModeRef.current === "owner") {
          refreshJobs();
        }
      },
      onRelayStatus: (event) => {
        setRelayStatus(event.status);
        setRelayMessage(event.message);
        setRelayAuthError(event.authError);
        setKioskState((prev) => ({
          ...prev,
          relayConnected: event.connected,
          relayStatus: event.status,
          relayMessage: event.message,
          relayAuthError: event.authError,
        }));
      },
    })
      .then((fns) => {
        if (!active) {
          fns.forEach((fn) => fn());
        } else {
          unlisteners = fns;
        }
      })
      .catch(() => {});

    loadState();
    getAppVersion().then(setCurrentVersion).catch(() => {});
    runUpdateCheck();

    const updateTimer = window.setInterval(() => {
      runUpdateCheck();
    }, 4 * 60 * 60 * 1000);

    return () => {
      active = false;
      window.clearInterval(updateTimer);
      unlisteners.forEach((fn) => fn());
    };
  }, [loadState, refreshJobs, runUpdateCheck]);

  // Ctrl+Shift+S / Cmd+Shift+S shortcut to open Owner Settings
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (kioskState.setupComplete) {
          setSettingsOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [kioskState.setupComplete]);

  // F11 and Escape key listeners for fullscreen toggle/exit
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        try {
          const next = await toggleFullscreen();
          setIsFullscreen(next);
        } catch (err) {
          console.error("Failed to toggle fullscreen via F11:", err);
        }
      } else if (e.key === "Escape" && isFullscreen) {
        e.preventDefault();
        try {
          await setFullscreen(false);
          setIsFullscreen(false);
        } catch (err) {
          console.error("Failed to exit fullscreen via Escape:", err);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen]);

  const handleCornerTap = () => {
    tapCountRef.current += 1;
    if (tapTimerRef.current) {
      window.clearTimeout(tapTimerRef.current);
    }
    if (tapCountRef.current >= 5) {
      tapCountRef.current = 0;
      if (kioskState.setupComplete) {
        setSettingsOpen(true);
      }
      return;
    }
    tapTimerRef.current = window.setTimeout(() => {
      tapCountRef.current = 0;
    }, 2500);
  };

  const handleVerifyAndPrint = useCallback(async () => {
    if (otp.length !== 6) return;
    setOtpStatus("verifying");
    setOtpMessage("Verifying OTP and sending to printer...");
    setPrintedJob(null);
    try {
      const res = await verifyOtpAndPrint(otp);
      setOtpStatus("success");
      setPrintedJob(res?.job ?? null);
      setOtpMessage(
        res?.message || "OTP verified! Your document is printing now."
      );
      setOtp("");
      window.setTimeout(() => {
        setOtpStatus("idle");
        setOtpMessage("");
        setPrintedJob(null);
      }, 6000);
    } catch (err) {
      setOtpStatus("error");
      setPrintedJob(null);
      setOtpMessage(
        typeof err === "string"
          ? err
          : "Invalid or already used OTP. Please check and try again."
      );
    }
  }, [otp]);

  const handleOwnerQueuePrint = async (jobOtp: string) => {
    setPrintingJobOtp(jobOtp);
    try {
      await verifyOtpAndPrint(jobOtp);
      await refreshJobs();
    } catch (err) {
      console.error("Direct print failed:", err);
    } finally {
      setPrintingJobOtp(null);
    }
  };

  const handleOwnerQueueCancel = async (jobId: string) => {
    setCancellingJobId(jobId);
    try {
      await cancelJob(jobId);
      await refreshJobs();
    } catch (err) {
      console.error("Cancel job failed:", err);
    } finally {
      setCancellingJobId(null);
    }
  };

  const handleDateChange = (nextDate: string | null) => {
    setSelectedDate(nextDate);
    selectedDateRef.current = nextDate;
    refreshJobs(nextDate);
  };

  const handleReRegister = async () => {
    setReRegistering(true);
    try {
      const next = await resetMachineIdentity();
      setKioskState(next);
      setRelayStatus(next.relayStatus);
      setRelayMessage(next.relayMessage);
      setRelayAuthError(next.relayAuthError);
      setLoadError("");
    } catch (err) {
      setLoadError(
        typeof err === "string"
          ? err
          : "Failed to re-register kiosk machine ID."
      );
    } finally {
      setReRegistering(false);
    }
  };

  const isRelayOnline = relayStatus === "connected";
  const hasRelayAuthError = !isRelayOnline && Boolean(relayAuthError);
  const isRelayError =
    relayStatus === "error" || relayStatus === "disconnected" || hasRelayAuthError;
  const relayLabel = isRelayOnline
    ? "Relay Online"
    : hasRelayAuthError
      ? "Relay Auth Failed"
      : isRelayError
        ? "Relay Offline"
        : "Connecting...";
  const relayDotClass = isRelayOnline
    ? "online"
    : isRelayError
      ? "error"
      : "offline";

  return (
    <div className="kiosk-shell">
      <header className="kiosk-header">
        <div className="brand">
          <div className="brand-icon">
            <Printer size={22} color="#ffffff" />
          </div>
          <div>
            <div className="brand-title">JetPrint Kiosk</div>
            <div className="brand-subtitle">
              Machine ID: {kioskState.machineId}
              {kioskState.defaultPrinter ? ` • Printer: ${kioskState.defaultPrinter}` : ""}
            </div>
          </div>
        </div>

        <div className="header-status">
          {availableUpdate && (
            <button
              type="button"
              className="status-pill"
              style={{
                borderColor: "rgba(99, 102, 241, 0.45)",
                color: "#c7d2fe",
                background: "rgba(99, 102, 241, 0.16)",
              }}
              onClick={() => setSettingsOpen(true)}
            >
              <DownloadCloud size={14} />
              <span>Update v{availableUpdate.version}</span>
            </button>
          )}

          <div
            className={`status-pill ${isRelayError ? "error" : ""}`}
            title={relayAuthError ?? relayMessage ?? undefined}
          >
            <span className={`status-dot ${relayDotClass}`} />
            {isRelayOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span>{relayLabel}</span>
          </div>

          <button
            type="button"
            className="fullscreen-trigger-btn"
            onClick={handleToggleFullscreen}
            title={isFullscreen ? "Exit Fullscreen (F11)" : "Enter Fullscreen (F11)"}
            aria-label={isFullscreen ? "Exit Fullscreen (F11)" : "Enter Fullscreen (F11)"}
          >
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>

          <button
            type="button"
            className="settings-trigger-btn"
            onClick={() => setSettingsOpen(true)}
            title="Owner Settings (Ctrl+Shift+S)"
            aria-label="Owner Settings"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      {loadError && (
        <div className="status-banner error" style={{ maxWidth: "100%" }}>
          <span>{loadError}</span>
        </div>
      )}

      {hasRelayAuthError && (
        <div
          className="status-banner error"
          style={{
            maxWidth: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span>
            Relay authentication failed ({relayAuthError}). Re-register to
            generate a new machine ID and clear the stale token.
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleReRegister}
            disabled={reRegistering}
          >
            {reRegistering ? "Re-registering..." : "Re-register Machine"}
          </button>
        </div>
      )}

      <main className="kiosk-main">
        <QrPanel
          relayUrl={kioskState.qrRelayUrl || kioskState.relayUrl}
          machineId={kioskState.machineId}
          bwPricePaise={kioskState.bwPricePaise}
          colorPricePaise={kioskState.colorPricePaise}
        />

        {kioskState.kioskMode === "owner" ? (
          <OwnerModeQueue
            jobs={jobs}
            selectedDate={selectedDate}
            onDateChange={handleDateChange}
            onRefresh={() => refreshJobs()}
            onPrintJob={handleOwnerQueuePrint}
            onCancelJob={handleOwnerQueueCancel}
            printingOtp={printingJobOtp}
            cancellingJobId={cancellingJobId}
          />
        ) : (
          <OtpKeypad
            otp={otp}
            onChangeOtp={(next) => {
              setOtp(next);
              if (otpStatus === "error" || otpStatus === "success") {
                setOtpStatus("idle");
                setOtpMessage("");
                setPrintedJob(null);
              }
            }}
            onSubmit={handleVerifyAndPrint}
            status={otpStatus}
            feedbackMessage={otpMessage}
            printedJob={printedJob}
            disabled={!loaded || !kioskState.setupComplete}
          />
        )}
      </main>

      {/* Subtle 5-tap corner trigger */}
      <div
        className="corner-tap-zone"
        onClick={handleCornerTap}
        aria-hidden="true"
      />

      {loaded && kioskState.existingDataPrompt && (
        <ExistingDataModal
          machineId={kioskState.machineId}
          existingJobCount={kioskState.existingJobCount}
          onResolved={(next) => {
            setKioskState(next);
            setRelayStatus(next.relayStatus);
            setRelayMessage(next.relayMessage);
            if (!next.setupComplete) {
              setJobs([]);
            } else if (next.kioskMode === "owner") {
              refreshJobs();
            }
          }}
        />
      )}

      {loaded && !kioskState.existingDataPrompt && !kioskState.setupComplete && (
        <FirstRunWizard
          initialState={kioskState}
          onComplete={(next) => {
            if (next) {
              setKioskState(next);
              setRelayStatus(next.relayStatus);
              setRelayMessage(next.relayMessage);
            }
            loadState();
          }}
        />
      )}

      {settingsOpen && (
        <OwnerSettingsModal
          kioskState={kioskState}
          currentVersion={currentVersion}
          availableUpdate={availableUpdate}
          updateCheckError={updateCheckError}
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
          onCheckForUpdates={runUpdateCheck}
          onClose={() => setSettingsOpen(false)}
          onStateUpdated={(next) => {
            setKioskState(next);
            setRelayStatus(next.relayStatus);
            setRelayMessage(next.relayMessage);
            setRelayAuthError(next.relayAuthError);
            if (next.kioskMode === "owner") {
              refreshJobs();
            }
          }}
        />
      )}
    </div>
  );
};

export const App: React.FC = () => {
  const view = new URLSearchParams(window.location.search).get("view");
  if (view === "logs") {
    return <LogsWindow />;
  }
  return <KioskApp />;
};

export default App;
