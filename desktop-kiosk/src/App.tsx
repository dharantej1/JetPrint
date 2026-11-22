import React, { useCallback, useEffect, useRef, useState } from "react";
import { Printer, Settings, Wifi, WifiOff, DownloadCloud } from "lucide-react";
import type { KioskState, PrintJob, RelayStatus } from "./types";
import {
  type AppUpdate,
  cancelJob,
  checkForAppUpdate,
  getAppVersion,
  getKioskState,
  isFullscreen as checkIsFullscreen,
  listJobs,
  listenKioskEvents,
  printJobDirect,
  resetMachineIdentity,
  setFullscreen,
  syncActiveJobs,
  toggleFullscreen,
  updateSettings,
  verifyOtpAndPrint,
  type UpdateCheckResult,
} from "./api/tauri";
import { QrPanel } from "./components/QrPanel";
import { OtpKeypad, type OtpFeedbackStatus } from "./components/OtpKeypad";
import { FirstRunWizard } from "./components/FirstRunWizard";
import { ExistingDataModal } from "./components/ExistingDataModal";
import { OwnerUnlockModal } from "./components/OwnerUnlockModal";
import { DedicatedSettingsPage } from "./components/DedicatedSettingsPage";
import { OwnerModeQueue } from "./components/OwnerModeQueue";
import { getTodayLocalDate } from "./utils";
import { LogsWindow } from "./components/LogsWindow";
import { useKioskLayout } from "./hooks/useKioskLayout";

const FALLBACK_STATE: KioskState = {
  machineId: "LOADING",
  relayUrl: "http://localhost:3000",
  qrRelayUrl: "http://localhost:3000",
  bwPricePaise: 200,
  colorPricePaise: 1000,
  defaultPrinter: null,
  supportedPaperSizes: ["A4"],
  kioskMode: "self_service",
  setupComplete: true,
  relayConnected: false,
  relayStatus: "connecting",
  relayMessage: null,
  relayAuthError: null,
  existingDataPrompt: false,
  existingJobCount: 0,
  storagePath: "",
  rushMode: false,
  rushHourAutoPrint: false,
};

const KioskApp: React.FC = () => {
  const [kioskState, setKioskState] = useState<KioskState>(FALLBACK_STATE);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [relayStatus, setRelayStatus] = useState<RelayStatus>("connecting");
  const [relayMessage, setRelayMessage] = useState<string | null>(null);
  const [relayAuthError, setRelayAuthError] = useState<string | null>(null);
  const [reRegistering, setReRegistering] = useState(false);

  // Dedicated settings view routing state
  const [isSettingsUnlocked, setIsSettingsUnlocked] = useState(false);
  const [showUnlockModal, setShowUnlockModal] = useState(false);

  // Rush Hour Auto-Print state
  const [rushHourEnabled, setRushHourEnabled] = useState(false);
  const rushHourRef = useRef(rushHourEnabled);
  rushHourRef.current = rushHourEnabled;

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

  // Updater state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentVersion, setCurrentVersion] = useState("");
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdate | null>(null);
  const [updateCheckError, setUpdateCheckError] = useState<string | null>(null);
  const [isUpToDate, setIsUpToDate] = useState(false);
  const inProgressCheckRef = useRef<Promise<UpdateCheckResult> | null>(null);

  // Container & viewport responsive kiosk layout hook
  const { layoutMode, isSingleView, containerRef } = useKioskLayout();
  const [activeVerticalView, setActiveVerticalView] = useState<"qr" | "otp">("qr");

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

  // Inactivity auto-reset timer on OTP screen in single-view mode (45 seconds)
  useEffect(() => {
    if (!isSingleView || activeVerticalView !== "otp") return;

    let timeoutId: number;

    const resetTimer = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        setOtp("");
        setOtpStatus("idle");
        setOtpMessage("");
        setPrintedJob(null);
        setActiveVerticalView("qr");
      }, 45000); // 45 seconds of continuous inactivity
    };

    resetTimer();

    const onUserActivity = () => {
      resetTimer();
    };

    window.addEventListener("pointerdown", onUserActivity);
    window.addEventListener("keydown", onUserActivity);
    window.addEventListener("touchstart", onUserActivity);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("pointerdown", onUserActivity);
      window.removeEventListener("keydown", onUserActivity);
      window.removeEventListener("touchstart", onUserActivity);
    };
  }, [isSingleView, activeVerticalView]);

  const runUpdateCheck = useCallback(async (isBackground = false) => {
    if (inProgressCheckRef.current) {
      return inProgressCheckRef.current;
    }

    const checkPromise = (async () => {
      try {
        const result = await checkForAppUpdate();
        if (result.update) {
          setAvailableUpdate(result.update);
          setIsUpToDate(false);
          setUpdateCheckError(null);
        } else if (result.error) {
          setAvailableUpdate(null);
          setIsUpToDate(false);
          if (!isBackground) {
            setUpdateCheckError(result.error);
          }
        } else {
          setAvailableUpdate(null);
          setIsUpToDate(true);
          setUpdateCheckError(null);
        }
        return result;
      } finally {
        inProgressCheckRef.current = null;
      }
    })();

    inProgressCheckRef.current = checkPromise;
    return checkPromise;
  }, []);

  // 5-tap corner trigger tracking
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<number | null>(null);

  const refreshJobs = useCallback(async (dateOverride?: string | null) => {
    const date =
      dateOverride === undefined ? selectedDateRef.current : dateOverride;
    try {
      if (kioskModeRef.current === "owner") {
        await syncActiveJobs().catch(() => {});
      }
      const nextJobs = await listJobs(undefined, date ?? undefined);
      setJobs(nextJobs);
    } catch {
      // ignore transient errors
    }
  }, []);

  // Print queue to sequence print jobs to prevent concurrent printer collisions
  const printQueueRef = useRef<
    Array<{
      job: PrintJob;
      printer?: string;
      overrides?: Record<string, string>;
    }>
  >([]);
  const isPrintingRef = useRef(false);

  const processPrintQueue = useCallback(async () => {
    if (isPrintingRef.current) return;
    if (printQueueRef.current.length === 0) {
      setPrintingJobOtp(null);
      return;
    }

    isPrintingRef.current = true;
    const nextItem = printQueueRef.current.shift();
    if (!nextItem) {
      isPrintingRef.current = false;
      return;
    }

    const { job, printer, overrides } = nextItem;
    setPrintingJobOtp(job.otp);

    try {
      await printJobDirect(job.id, printer, overrides);
    } catch (err) {
      console.error("Print execution error:", err);
    } finally {
      await refreshJobs();
      isPrintingRef.current = false;
      // Process next job in queue if any
      processPrintQueue();
    }
  }, [refreshJobs]);

  const enqueueJobForPrint = useCallback(
    (job: PrintJob, printer?: string, overrides?: Record<string, string>) => {
      if (
        job.status === "printed" ||
        job.status === "cancelled" ||
        job.status === "expired"
      ) {
        return;
      }
      if (printQueueRef.current.some((item) => item.job.id === job.id)) {
        return;
      }
      printQueueRef.current.push({ job, printer, overrides });
      processPrintQueue();
    },
    [processPrintQueue]
  );

  const enqueueJobForPrintRef = useRef(enqueueJobForPrint);
  enqueueJobForPrintRef.current = enqueueJobForPrint;
  const refreshJobsRef = useRef(refreshJobs);
  refreshJobsRef.current = refreshJobs;

  const handleOwnerQueuePrint = useCallback(
    async (
      jobOrOtp: PrintJob | string,
      printerOverride?: string,
      printerOverrides?: Record<string, string>
    ) => {
      const job =
        typeof jobOrOtp === "string"
          ? jobs.find((j) => j.otp === jobOrOtp)
          : jobOrOtp;
      const otp = typeof jobOrOtp === "string" ? jobOrOtp : jobOrOtp.otp;

      if (job) {
        enqueueJobForPrint(job, printerOverride, printerOverrides);
      } else {
        setPrintingJobOtp(otp);
        try {
          await verifyOtpAndPrint(otp);
        } catch (err) {
          console.error("Print execution error:", err);
        } finally {
          await refreshJobs();
          setPrintingJobOtp(null);
        }
      }
    },
    [jobs, enqueueJobForPrint, refreshJobs]
  );

  const loadState = useCallback(async () => {
    try {
      const state = await getKioskState();
      setKioskState(state);
      const isRushActive =
        state.kioskMode === "owner" && Boolean(state.rushMode || state.rushHourAutoPrint);
      setRushHourEnabled(isRushActive);
      setRelayStatus(state.relayStatus);
      setRelayMessage(state.relayMessage);
      setRelayAuthError(state.relayAuthError);
      if (state.kioskMode === "owner") {
        await syncActiveJobs().catch(() => {});
        const nextJobs = await listJobs(undefined, selectedDateRef.current ?? undefined);
        setJobs(nextJobs);
        if (isRushActive) {
          const pending = nextJobs.filter((j) => j.status === "pending");
          for (const pj of pending) {
            enqueueJobForPrint(pj);
          }
        }
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
  }, [enqueueJobForPrint]);

  useEffect(() => {
    let active = true;
    let unlisteners: Array<() => void> = [];

    listenKioskEvents({
      onJobReceived: (incomingJob) => {
        if (kioskModeRef.current === "owner") {
          refreshJobsRef.current();
          // Handle Rush Hour Auto-Print: automatically queue incoming jobs upon the 'job-received' event
          if (rushHourRef.current && incomingJob) {
            console.log(
              "⚡ Rush Hour Auto-Print: automatically queueing incoming job",
              incomingJob.id,
              incomingJob.otp
            );
            enqueueJobForPrintRef.current(incomingJob);
          }
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

    // Delay background update check slightly on startup so OS network/DNS is ready
    const startupTimer = window.setTimeout(() => {
      runUpdateCheck(true);
    }, 3500);

    const updateTimer = window.setInterval(() => {
      runUpdateCheck(true);
    }, 4 * 60 * 60 * 1000);

    return () => {
      active = false;
      window.clearTimeout(startupTimer);
      window.clearInterval(updateTimer);
      unlisteners.forEach((fn) => fn());
    };
  }, [loadState, runUpdateCheck]);

  // Ctrl+Shift+S / Cmd+Shift+S shortcut to open Owner Settings
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (kioskState.setupComplete) {
          if (isSettingsUnlocked) {
            setIsSettingsUnlocked(false);
          } else {
            setShowUnlockModal(true);
          }
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [kioskState.setupComplete, isSettingsUnlocked]);

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
        setShowUnlockModal(true);
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
        setActiveVerticalView("qr");
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

  const handleToggleRushHour = async (enabled: boolean) => {
    if (kioskState.kioskMode !== "owner") return;
    setRushHourEnabled(enabled);
    try {
      const next = await updateSettings({
        rushMode: enabled,
        rushHourAutoPrint: enabled,
      });
      setKioskState(next);
      setRushHourEnabled(
        next.kioskMode === "owner" && Boolean(next.rushMode || next.rushHourAutoPrint)
      );
      if (enabled) {
        const currentJobs = await listJobs(undefined, selectedDateRef.current ?? undefined);
        const pending = currentJobs.filter((j) => j.status === "pending");
        for (const pj of pending) {
          enqueueJobForPrint(pj);
        }
      }
    } catch (err) {
      console.warn("Failed to persist rushMode setting:", err);
    }
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

  // Dedicated view routing: when unlocked, show DedicatedSettingsPage instead of Kiosk view
  if (isSettingsUnlocked) {
    return (
      <DedicatedSettingsPage
        kioskState={kioskState}
        currentVersion={currentVersion}
        availableUpdate={availableUpdate}
        updateCheckError={updateCheckError}
        isUpToDate={isUpToDate}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        onCheckForUpdates={() => runUpdateCheck(false)}
        onBackToKiosk={() => setIsSettingsUnlocked(false)}
        onStateUpdated={(next) => {
          setKioskState(next);
          setRushHourEnabled(
            next.kioskMode === "owner" && Boolean(next.rushMode || next.rushHourAutoPrint)
          );
          setRelayStatus(next.relayStatus);
          setRelayMessage(next.relayMessage);
          setRelayAuthError(next.relayAuthError);
          if (next.kioskMode === "owner") {
            refreshJobs();
          }
        }}
      />
    );
  }

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
              onClick={() => setShowUnlockModal(true)}
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
            className="settings-trigger-btn"
            onClick={() => setShowUnlockModal(true)}
            title="Owner Settings Space (Ctrl+Shift+S)"
            aria-label="Owner Settings Space"
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

      <main
        ref={containerRef}
        className={`kiosk-main kiosk-${layoutMode} ${kioskState.kioskMode === "owner" ? "kiosk-owner-layout" : ""}`}
        data-layout-mode={layoutMode}
      >
        {kioskState.kioskMode === "owner" ? (
          <>
            <QrPanel
              relayUrl={kioskState.qrRelayUrl || kioskState.relayUrl}
              machineId={kioskState.machineId}
              bwPricePaise={kioskState.bwPricePaise}
              colorPricePaise={kioskState.colorPricePaise}
            />
            <OwnerModeQueue
              jobs={jobs}
              selectedDate={selectedDate}
              onDateChange={handleDateChange}
              onRefresh={() => refreshJobs()}
              onPrintJob={handleOwnerQueuePrint}
              onCancelJob={handleOwnerQueueCancel}
              printingOtp={printingJobOtp}
              cancellingJobId={cancellingJobId}
              rushHourEnabled={rushHourEnabled}
              onToggleRushHour={handleToggleRushHour}
              configuredPrinters={kioskState.configuredPrinters}
            />
          </>
        ) : !isSingleView ? (
          <>
            <QrPanel
              relayUrl={kioskState.qrRelayUrl || kioskState.relayUrl}
              machineId={kioskState.machineId}
              bwPricePaise={kioskState.bwPricePaise}
              colorPricePaise={kioskState.colorPricePaise}
            />
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
          </>
        ) : activeVerticalView === "qr" ? (
          <QrPanel
            relayUrl={kioskState.qrRelayUrl || kioskState.relayUrl}
            machineId={kioskState.machineId}
            bwPricePaise={kioskState.bwPricePaise}
            colorPricePaise={kioskState.colorPricePaise}
            onNavigateToOtp={() => setActiveVerticalView("otp")}
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
            onNavigateToQr={() => {
              setOtp("");
              setOtpStatus("idle");
              setOtpMessage("");
              setPrintedJob(null);
              setActiveVerticalView("qr");
            }}
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

      {showUnlockModal && (
        <OwnerUnlockModal
          onUnlock={() => {
            setShowUnlockModal(false);
            setIsSettingsUnlocked(true);
          }}
          onClose={() => setShowUnlockModal(false)}
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
