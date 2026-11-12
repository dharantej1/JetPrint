import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { Printer, Settings, Wifi, WifiOff, DownloadCloud } from "lucide-react";
import type { KioskState, PrintJob } from "./types";
import {
  checkForAppUpdate,
  getKioskState,
  listJobs,
  listenKioskEvents,
  verifyOtpAndPrint,
} from "./api/tauri";
import { QrPanel } from "./components/QrPanel";
import { OtpKeypad, type OtpFeedbackStatus } from "./components/OtpKeypad";
import { FirstRunWizard } from "./components/FirstRunWizard";
import { OwnerSettingsModal } from "./components/OwnerSettingsModal";
import { OwnerModeQueue } from "./components/OwnerModeQueue";

const FALLBACK_STATE: KioskState = {
  machineId: "LOADING",
  relayUrl: "http://localhost:3000",
  bwPricePaise: 200,
  colorPricePaise: 1000,
  defaultPrinter: null,
  kioskMode: "self_service",
  setupComplete: true,
  relayConnected: false,
};

export const App: React.FC = () => {
  const [kioskState, setKioskState] = useState<KioskState>(FALLBACK_STATE);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [relayConnected, setRelayConnected] = useState(false);

  // OTP entry state
  const [otp, setOtp] = useState("");
  const [otpStatus, setOtpStatus] = useState<OtpFeedbackStatus>("idle");
  const [otpMessage, setOtpMessage] = useState("");

  // Owner mode queue state
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [printingJobOtp, setPrintingJobOtp] = useState<string | null>(null);

  // Owner modal & updater state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);

  // 5-tap corner trigger tracking
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<number | null>(null);

  const loadState = useCallback(async () => {
    try {
      const state = await getKioskState();
      setKioskState(state);
      setRelayConnected(state.relayConnected);
      if (state.kioskMode === "owner") {
        listJobs().then(setJobs).catch(() => {});
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
  }, []);

  useEffect(() => {
    loadState();
    checkForAppUpdate().then((update) => {
      if (update) {
        setAvailableUpdate(update);
      }
    });
  }, [loadState]);

  useEffect(() => {
    let unlisteners: Array<() => void> = [];
    listenKioskEvents({
      onJobReceived: () => {
        if (kioskState.kioskMode === "owner") {
          listJobs().then(setJobs).catch(() => {});
        }
      },
      onRelayStatus: (event) => {
        setRelayConnected(event.connected);
      },
    })
      .then((fns) => {
        unlisteners = fns;
      })
      .catch(() => {});

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [kioskState.kioskMode]);

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
    try {
      const res = await verifyOtpAndPrint(otp);
      setOtpStatus("success");
      setOtpMessage(
        res?.message || "OTP verified! Your document is printing now."
      );
      setOtp("");
      window.setTimeout(() => {
        setOtpStatus("idle");
        setOtpMessage("");
      }, 6000);
    } catch (err) {
      setOtpStatus("error");
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
      const refreshed = await listJobs();
      setJobs(refreshed);
    } catch (err) {
      console.error("Direct print failed:", err);
    } finally {
      setPrintingJobOtp(null);
    }
  };

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

          <div className="status-pill">
            <span className={`status-dot ${relayConnected ? "online" : "offline"}`} />
            {relayConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span>{relayConnected ? "Relay Online" : "Connecting..."}</span>
          </div>

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

      <main className="kiosk-main">
        <QrPanel
          relayUrl={kioskState.relayUrl}
          machineId={kioskState.machineId}
          bwPricePaise={kioskState.bwPricePaise}
          colorPricePaise={kioskState.colorPricePaise}
        />

        {kioskState.kioskMode === "owner" ? (
          <OwnerModeQueue
            jobs={jobs}
            onRefresh={() => listJobs().then(setJobs).catch(() => {})}
            onPrintJob={handleOwnerQueuePrint}
            printingOtp={printingJobOtp}
          />
        ) : (
          <OtpKeypad
            otp={otp}
            onChangeOtp={(next) => {
              setOtp(next);
              if (otpStatus === "error" || otpStatus === "success") {
                setOtpStatus("idle");
                setOtpMessage("");
              }
            }}
            onSubmit={handleVerifyAndPrint}
            status={otpStatus}
            feedbackMessage={otpMessage}
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

      {loaded && !kioskState.setupComplete && (
        <FirstRunWizard
          onComplete={() => {
            loadState();
          }}
        />
      )}

      {settingsOpen && (
        <OwnerSettingsModal
          kioskState={kioskState}
          availableUpdate={availableUpdate}
          onClose={() => setSettingsOpen(false)}
          onStateUpdated={(next) => {
            setKioskState(next);
            if (next.kioskMode === "owner") {
              listJobs().then(setJobs).catch(() => {});
            }
          }}
        />
      )}
    </div>
  );
};

export default App;
