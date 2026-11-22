import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  Printer,
  DollarSign,
  Sliders,
  Cloud,
  Cpu,
  RefreshCw,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FolderOpen,
  Maximize,
  Minimize,
  DownloadCloud,
  FileText,
  Zap,
  Check,
  Keyboard as KeyboardIcon,
  ChevronDown,
} from "lucide-react";
import type {
  ConfiguredPrinter,
  KioskMode,
  KioskState,
  PrinterInfo,
  PrinterPoolType,
} from "../types";
import {
  type AppUpdate,
  type UpdateCheckResult,
  connectRelay,
  getConfiguredPrinters,
  installUpdateAndRelaunch,
  isFullscreen as checkIsFullscreen,
  listPrinters,
  openLogsWindow,
  pickStorageFolder,
  resetMachineIdentity,
  resolveStoragePreviewPath,
  saveConfiguredPrinters,
  setStoragePath,
  testPrint,
  toggleFullscreen,
  updateSettings,
} from "../api/tauri";
import { VirtualKeyboard } from "./VirtualKeyboard";

export interface DedicatedSettingsPageProps {
  kioskState: KioskState;
  currentVersion: string;
  availableUpdate: AppUpdate | null;
  updateCheckError: string | null;
  isUpToDate?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onCheckForUpdates: () => Promise<UpdateCheckResult>;
  onBackToKiosk: () => void;
  onStateUpdated: (next: KioskState) => void;
}

type SettingsTab =
  | "printers"
  | "pricing"
  | "mode"
  | "relay"
  | "system";

const CAPABILITY_OPTIONS = ["B&W", "Color", "A4", "A3", "Legal", "Duplex"];

const POOL_OPTIONS: { id: PrinterPoolType; label: string; description: string }[] = [
  { id: "bw", label: "B&W Pool", description: "Standard monochrome documents" },
  { id: "color", label: "Color Pool", description: "Color pages & photo prints" },
  { id: "large_format", label: "Large Format", description: "A3 & Legal paper sizes" },
  { id: "default", label: "Default Pool", description: "Fallback queue for all jobs" },
];

export const DedicatedSettingsPage: React.FC<DedicatedSettingsPageProps> = ({
  kioskState,
  currentVersion,
  availableUpdate,
  updateCheckError,
  isUpToDate,
  isFullscreen: isFullscreenProp,
  onToggleFullscreen,
  onCheckForUpdates,
  onBackToKiosk,
  onStateUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>("printers");
  const [isFullscreenLocal, setIsFullscreenLocal] = useState(
    isFullscreenProp ?? false
  );

  // Global save/error states
  const [saving, setSaving] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState("");
  const [saveErrorMessage, setSaveErrorMessage] = useState("");

  // Printers & Pools state
  const [detectedPrinters, setDetectedPrinters] = useState<PrinterInfo[]>([]);
  const [configuredPrinters, setConfiguredPrinters] = useState<ConfiguredPrinter[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [testPrintStatus, setTestPrintStatus] = useState<Record<string, string>>({});
  const [defaultPrinterName, setDefaultPrinterName] = useState<string>(
    kioskState.defaultPrinter ?? ""
  );

  // Pricing state
  const [bwRupees, setBwRupees] = useState<string>(
    (kioskState.bwPricePaise / 100).toFixed(2)
  );
  const [colorRupees, setColorRupees] = useState<string>(
    (kioskState.colorPricePaise / 100).toFixed(2)
  );
  const [supportedPaperSizes, setSupportedPaperSizes] = useState<string[]>(
    kioskState.supportedPaperSizes?.length > 0
      ? kioskState.supportedPaperSizes
      : ["A4"]
  );

  // Mode state
  const [kioskMode, setKioskMode] = useState<KioskMode>(kioskState.kioskMode);
  const [rushHourAutoPrint, setRushHourAutoPrint] = useState<boolean>(
    kioskState.kioskMode === "owner" && Boolean(kioskState.rushHourAutoPrint ?? kioskState.rushMode)
  );

  // Printer Master-Detail & pool filter state
  const [selectedPrinterKey, setSelectedPrinterKey] = useState<string>("");
  const [poolFilter, setPoolFilter] = useState<string>("all");

  useEffect(() => {
    if (configuredPrinters.length > 0) {
      if (
        !selectedPrinterKey ||
        !configuredPrinters.some(
          (p) => (p.systemName || p.name) === selectedPrinterKey
        )
      ) {
        const def =
          configuredPrinters.find(
            (p) => p.isDefault || p.name === defaultPrinterName
          ) || configuredPrinters[0];
        setSelectedPrinterKey(def.systemName || def.name);
      }
    }
  }, [configuredPrinters, defaultPrinterName, selectedPrinterKey]);

  // Relay state
  const [relayUrl, setRelayUrl] = useState<string>(kioskState.relayUrl);
  const [reconnectingRelay, setReconnectingRelay] = useState(false);
  const [reRegistering, setReRegistering] = useState(false);
  const [storageFolder, setStorageFolder] = useState<string>(
    kioskState.storagePath || ""
  );

  // Updater state
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [checkedUpToDate, setCheckedUpToDate] = useState(isUpToDate ?? false);
  const [checkError, setCheckError] = useState<string | null>(updateCheckError);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState("");

  // Virtual Keyboard state
  const [activeVk, setActiveVk] = useState<{
    label: string;
    field: string;
    type?: "text" | "password" | "number" | "url";
  } | null>(null);

  // Sync fullscreen prop
  useEffect(() => {
    if (isFullscreenProp !== undefined) {
      setIsFullscreenLocal(isFullscreenProp);
    } else {
      checkIsFullscreen().then(setIsFullscreenLocal).catch(() => {});
    }
  }, [isFullscreenProp]);

  // Load initial printers & pools
  const fetchPrinters = async () => {
    setLoadingPrinters(true);
    try {
      const [sysPrinters, cfgPrinters] = await Promise.all([
        listPrinters().catch(() => [] as PrinterInfo[]),
        getConfiguredPrinters().catch(() => [] as ConfiguredPrinter[]),
      ]);
      setDetectedPrinters(sysPrinters);

      if (cfgPrinters && cfgPrinters.length > 0) {
        setConfiguredPrinters(cfgPrinters);
      } else {
        // Map system printers to initial configured printers
        const initial = sysPrinters.map((p) => {
          const isDef = p.isDefault || p.name === kioskState.defaultPrinter;
          return {
            id: p.systemName || p.name,
            systemName: p.systemName || p.name,
            name: p.name,
            nickname: p.name,
            enabled: true,
            capabilities: ["B&W", "A4"],
            pool: (isDef ? "default" : "bw") as PrinterPoolType,
            isDefault: isDef,
            state: p.state,
          };
        });
        setConfiguredPrinters(initial);
      }
    } catch (err) {
      console.warn("Failed to load printers:", err);
    } finally {
      setLoadingPrinters(false);
    }
  };

  useEffect(() => {
    fetchPrinters();
  }, []);

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

  const handleTogglePaperSize = (size: string) => {
    setSupportedPaperSizes((prev) => {
      if (prev.includes(size)) {
        if (prev.length === 1) return prev; // Keep at least one size
        return prev.filter((s) => s !== size);
      } else {
        return [...prev, size];
      }
    });
  };

  // Printer configuration helpers
  const handleUpdatePrinterField = (
    systemName: string,
    updates: Partial<ConfiguredPrinter>
  ) => {
    setConfiguredPrinters((prev) =>
      prev.map((p) =>
        p.systemName === systemName || p.name === systemName
          ? { ...p, ...updates }
          : p
      )
    );
  };

  const handleToggleCapability = (systemName: string, cap: string) => {
    setConfiguredPrinters((prev) =>
      prev.map((p) => {
        if (p.systemName === systemName || p.name === systemName) {
          const exists = p.capabilities.includes(cap);
          const nextCaps = exists
            ? p.capabilities.filter((c) => c !== cap)
            : [...p.capabilities, cap];
          return { ...p, capabilities: nextCaps };
        }
        return p;
      })
    );
  };

  const handleSetDefaultPrinter = (printerName: string) => {
    setDefaultPrinterName(printerName);
    setConfiguredPrinters((prev) =>
      prev.map((p) => ({
        ...p,
        isDefault: p.name === printerName || p.systemName === printerName,
      }))
    );
  };

  const handleTestPrint = async (printer: ConfiguredPrinter) => {
    const key = printer.name || printer.systemName || printer.id;
    setTestPrintStatus((prev) => ({ ...prev, [key]: "Sending test print..." }));
    try {
      const msg = await testPrint(key);
      setTestPrintStatus((prev) => ({
        ...prev,
        [key]: msg || "Test print sent successfully!",
      }));
      setTimeout(() => {
        setTestPrintStatus((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 4000);
    } catch (err) {
      setTestPrintStatus((prev) => ({
        ...prev,
        [key]: typeof err === "string" ? err : "Failed to send test print",
      }));
    }
  };

  // Virtual keyboard value binding
  const getVkValue = (): string => {
    if (!activeVk) return "";
    if (activeVk.field === "bwRupees") return bwRupees;
    if (activeVk.field === "colorRupees") return colorRupees;
    if (activeVk.field === "relayUrl") return relayUrl;
    if (activeVk.field === "storageFolder") return storageFolder;
    if (activeVk.field.startsWith("nickname:")) {
      const sysName = activeVk.field.replace("nickname:", "");
      const p = configuredPrinters.find(
        (x) => x.systemName === sysName || x.name === sysName
      );
      return p?.nickname ?? p?.name ?? "";
    }
    return "";
  };

  const handleVkChange = (val: string) => {
    if (!activeVk) return;
    if (activeVk.field === "bwRupees") {
      setBwRupees(val);
    } else if (activeVk.field === "colorRupees") {
      setColorRupees(val);
    } else if (activeVk.field === "relayUrl") {
      setRelayUrl(val);
    } else if (activeVk.field === "storageFolder") {
      setStorageFolder(val);
    } else if (activeVk.field.startsWith("nickname:")) {
      const sysName = activeVk.field.replace("nickname:", "");
      handleUpdatePrinterField(sysName, { nickname: val });
    }
  };

  // Save Settings
  const handleSaveAll = async () => {
    setSaving(true);
    setSaveErrorMessage("");
    setSaveSuccessMessage("");

    const bwPaise = Math.max(0, Math.round(parseFloat(bwRupees || "0") * 100));
    const colorPaise = Math.max(0, Math.round(parseFloat(colorRupees || "0") * 100));

    if (Number.isNaN(bwPaise) || Number.isNaN(colorPaise)) {
      setSaveErrorMessage("Please enter valid numeric pricing values.");
      setSaving(false);
      return;
    }

    try {
      // 1. Save Configured Printers
      await saveConfiguredPrinters(configuredPrinters).catch((err) => {
        console.warn("Saving configured printers warning:", err);
      });

      // 2. Update general settings
      let updated = await updateSettings({
        defaultPrinter: defaultPrinterName || undefined,
        supportedPaperSizes,
        bwPricePaise: bwPaise,
        colorPricePaise: colorPaise,
        kioskMode,
        relayUrl: relayUrl.trim(),
        configuredPrinters,
        rushMode: kioskMode === "owner" ? rushHourAutoPrint : false,
        rushHourAutoPrint: kioskMode === "owner" ? rushHourAutoPrint : false,
      });

      // 3. Storage folder update if changed
      const trimmedStorage = storageFolder.trim();
      if (
        trimmedStorage &&
        resolveStoragePreviewPath(trimmedStorage) !== kioskState.storagePath
      ) {
        updated = await setStoragePath(trimmedStorage);
        setStorageFolder(updated.storagePath);
      }

      // 4. Reconnect relay if url changed
      if (relayUrl.trim() !== kioskState.relayUrl) {
        const reconnected = await connectRelay(relayUrl.trim()).catch(() => null);
        if (reconnected) updated = reconnected;
      }

      onStateUpdated(updated);
      setSaveSuccessMessage("Settings saved successfully.");
      setTimeout(() => setSaveSuccessMessage(""), 4000);
    } catch (err) {
      setSaveErrorMessage(
        typeof err === "string" ? err : "Failed to save configuration settings."
      );
    } finally {
      setSaving(false);
    }
  };

  // Re-register machine
  const handleReRegisterMachine = async () => {
    const confirm = window.confirm(
      "Re-register this machine? This will generate a new machine identity token."
    );
    if (!confirm) return;
    setReRegistering(true);
    try {
      const next = await resetMachineIdentity();
      onStateUpdated(next);
      setSaveSuccessMessage("Machine identity re-registered successfully.");
    } catch (err) {
      setSaveErrorMessage(
        typeof err === "string" ? err : "Failed to re-register machine."
      );
    } finally {
      setReRegistering(false);
    }
  };

  // Reconnect relay
  const handleReconnectRelay = async () => {
    setReconnectingRelay(true);
    setSaveErrorMessage("");
    try {
      const next = await connectRelay(relayUrl.trim());
      onStateUpdated({
        ...next,
        relayStatus: "connecting",
        relayConnected: false,
        relayMessage: "Connecting to relay...",
      });
      setSaveSuccessMessage("Reconnecting to relay...");
    } catch (err) {
      setSaveErrorMessage(
        typeof err === "string" ? err : "Relay connection failed."
      );
    } finally {
      setTimeout(() => setReconnectingRelay(false), 600);
    }
  };

  // Check for updates
  const handleCheckForUpdates = async () => {
    setCheckingUpdates(true);
    setCheckedUpToDate(false);
    setCheckError(null);
    setUpdateError("");
    try {
      const result = await onCheckForUpdates();
      if (result.error) {
        setCheckError(result.error);
        setCheckedUpToDate(false);
      } else if (!result.update) {
        setCheckedUpToDate(true);
        setCheckError(null);
      } else {
        setCheckedUpToDate(false);
        setCheckError(null);
      }
    } catch (err) {
      setCheckError(
        typeof err === "string" ? err : "Failed to check for updates."
      );
    } finally {
      setCheckingUpdates(false);
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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "var(--bg-primary)",
        color: "var(--text-primary)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Top Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 24px",
          background: "var(--bg-card)",
          borderBottom: "1px solid var(--border-subtle)",
          backdropFilter: "blur(16px)",
          flexShrink: 0,
          gap: 16,
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={onBackToKiosk}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px",
              borderRadius: "var(--radius-sm)",
              fontWeight: 600,
              fontSize: 14,
            }}
            title="Return to Customer Kiosk View"
          >
            <ArrowLeft size={16} />
            <span>Back to Kiosk</span>
          </button>

          <div>
            <h1
              style={{
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                margin: 0,
              }}
            >
              Kiosk Settings &amp; Printer Pools
            </h1>
            <p
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                margin: 0,
              }}
            >
              Configure printers, smart routing pools, pricing, and system parameters
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {saveSuccessMessage && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: "var(--success)",
                fontSize: 13,
                fontWeight: 600,
                background: "var(--success-bg)",
                padding: "6px 12px",
                borderRadius: 999,
              }}
            >
              <CheckCircle2 size={15} />
              {saveSuccessMessage}
            </span>
          )}

          {saveErrorMessage && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: "var(--danger)",
                fontSize: 13,
                fontWeight: 600,
                background: "var(--danger-bg)",
                padding: "6px 12px",
                borderRadius: 999,
              }}
            >
              <AlertCircle size={15} />
              {saveErrorMessage}
            </span>
          )}

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 999,
              fontSize: 12,
              background: "rgba(15, 23, 42, 0.7)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
          >
            <span>Machine:</span>
            <code style={{ color: "#a5b4fc", fontWeight: 600 }}>
              {kioskState.machineId}
            </code>
          </div>

          <button
            type="button"
            className="btn-primary"
            onClick={handleSaveAll}
            disabled={saving}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 18px",
              fontWeight: 600,
            }}
          >
            {saving ? (
              <>
                <Loader2 size={16} className="spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save size={16} />
                <span>Save Changes</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Workspace Layout (Sidebar + Content Panel) */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left Navigation Sidebar */}
        <nav
          style={{
            width: 240,
            background: "rgba(15, 23, 42, 0.7)",
            borderRight: "1px solid var(--border-subtle)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "16px 12px",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button
              type="button"
              onClick={() => setActiveTab("printers")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                borderRadius: "var(--radius-sm)",
                fontSize: 14,
                fontWeight: 600,
                textAlign: "left",
                color:
                  activeTab === "printers"
                    ? "#ffffff"
                    : "var(--text-secondary)",
                background:
                  activeTab === "printers"
                    ? "var(--accent-primary)"
                    : "transparent",
                transition: "all 0.15s ease",
              }}
            >
              <Printer size={18} />
              <span>Printers &amp; Pools</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("pricing")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                borderRadius: "var(--radius-sm)",
                fontSize: 14,
                fontWeight: 600,
                textAlign: "left",
                color:
                  activeTab === "pricing"
                    ? "#ffffff"
                    : "var(--text-secondary)",
                background:
                  activeTab === "pricing"
                    ? "var(--accent-primary)"
                    : "transparent",
                transition: "all 0.15s ease",
              }}
            >
              <DollarSign size={18} />
              <span>Pricing &amp; Paper</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("mode")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                borderRadius: "var(--radius-sm)",
                fontSize: 14,
                fontWeight: 600,
                textAlign: "left",
                color:
                  activeTab === "mode" ? "#ffffff" : "var(--text-secondary)",
                background:
                  activeTab === "mode"
                    ? "var(--accent-primary)"
                    : "transparent",
                transition: "all 0.15s ease",
              }}
            >
              <Sliders size={18} />
              <span>Operating Mode</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("relay")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                borderRadius: "var(--radius-sm)",
                fontSize: 14,
                fontWeight: 600,
                textAlign: "left",
                color:
                  activeTab === "relay" ? "#ffffff" : "var(--text-secondary)",
                background:
                  activeTab === "relay"
                    ? "var(--accent-primary)"
                    : "transparent",
                transition: "all 0.15s ease",
              }}
            >
              <Cloud size={18} />
              <span>Cloud Relay</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("system")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                borderRadius: "var(--radius-sm)",
                fontSize: 14,
                fontWeight: 600,
                textAlign: "left",
                color:
                  activeTab === "system"
                    ? "#ffffff"
                    : "var(--text-secondary)",
                background:
                  activeTab === "system"
                    ? "var(--accent-primary)"
                    : "transparent",
                transition: "all 0.15s ease",
              }}
            >
              <Cpu size={18} />
              <span>System &amp; Updates</span>
            </button>
          </div>

          {/* Sidebar Status Info */}
          <div
            style={{
              padding: "12px",
              borderRadius: "var(--radius-sm)",
              background: "rgba(15, 23, 42, 0.6)",
              border: "1px solid var(--border-subtle)",
              fontSize: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ color: "var(--text-secondary)" }}>Relay:</span>
              <span
                style={{
                  color:
                    kioskState.relayStatus === "connected"
                      ? "var(--success)"
                      : "var(--warning)",
                  fontWeight: 600,
                }}
              >
                {kioskState.relayStatus}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ color: "var(--text-secondary)" }}>Printers:</span>
              <span style={{ fontWeight: 600 }}>
                {configuredPrinters.filter((p) => p.enabled).length} Active
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ color: "var(--text-secondary)" }}>Version:</span>
              <span style={{ fontFamily: "monospace", color: "#cbd5e1" }}>
                v{currentVersion || "0.1.0"}
              </span>
            </div>
          </div>
        </nav>

        {/* Right Content Panel (Scrollable) */}
        <main
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          {/* TAB 1: PRINTERS & POOLS */}
          {activeTab === "printers" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                }}
              >
                <div>
                  <h2
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      margin: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <Printer size={22} color="#818cf8" />
                    <span>Printers &amp; Pool Assignments</span>
                  </h2>
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--text-secondary)",
                      marginTop: 4,
                      marginBottom: 0,
                    }}
                  >
                    Configure printer nicknames, routing pools (B&amp;W, Color, Large Format), and paper capabilities.
                  </p>
                </div>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={fetchPrinters}
                  disabled={loadingPrinters}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                >
                  <RefreshCw
                    size={15}
                    className={loadingPrinters ? "spin" : ""}
                  />
                  <span>Rescan System Printers</span>
                </button>
              </div>

              {/* Interactive Pool Filter Tabs */}
              <div className="pool-filter-tabs">
                <button
                  type="button"
                  className={`pool-tab-btn ${poolFilter === "all" ? "active" : ""}`}
                  onClick={() => setPoolFilter("all")}
                >
                  <div className="pool-tab-top">
                    <span className="pool-tab-label">All Available</span>
                    <span className="pool-tab-badge">{configuredPrinters.length}</span>
                  </div>
                  <span className="pool-tab-desc">All system printers</span>
                </button>

                {POOL_OPTIONS.map((pool) => {
                  const assigned = configuredPrinters.filter(
                    (p) => p.pool === pool.id && p.enabled
                  );
                  const isFilterActive = poolFilter === pool.id;
                  return (
                    <button
                      key={pool.id}
                      type="button"
                      className={`pool-tab-btn ${isFilterActive ? "active" : ""}`}
                      onClick={() => setPoolFilter(pool.id)}
                    >
                      <div className="pool-tab-top">
                        <span className="pool-tab-label">{pool.label}</span>
                        <span
                          className={`pool-tab-badge ${assigned.length > 0 ? "has-printers" : ""}`}
                        >
                          {assigned.length} {assigned.length === 1 ? "printer" : "printers"}
                        </span>
                      </div>
                      <span className="pool-tab-desc">{pool.description}</span>
                    </button>
                  );
                })}
              </div>

              {/* Master-Detail Printer Layout */}
              {configuredPrinters.length === 0 ? (
                <div className="printers-empty-panel">
                  <p>
                    {loadingPrinters
                      ? "Scanning for connected printers..."
                      : "No printers detected. Connect a printer or click 'Rescan System Printers'."}
                  </p>
                </div>
              ) : (
                <div className="printers-master-detail-grid">
                  {/* Master List Column */}
                  <div className="printers-master-pane">
                    <div className="pane-header-title">
                      <span>Available Printers</span>
                      <span className="count-pill">
                        {
                          configuredPrinters.filter(
                            (p) => poolFilter === "all" || p.pool === poolFilter
                          ).length
                        }
                      </span>
                    </div>

                    <div className="printers-list-scroll">
                      {configuredPrinters
                        .filter(
                          (p) => poolFilter === "all" || p.pool === poolFilter
                        )
                        .map((printer) => {
                          const printerKey = printer.systemName || printer.name;
                          const isSelected =
                            selectedPrinterKey === printerKey ||
                            selectedPrinterKey === printer.name;
                          const isDefaultPr =
                            printer.isDefault || defaultPrinterName === printer.name;

                          return (
                            <div
                              key={printerKey}
                              className={`printer-item-card ${isSelected ? "selected" : ""} ${!printer.enabled ? "disabled" : ""}`}
                              onClick={() => setSelectedPrinterKey(printerKey)}
                            >
                              <div className="printer-item-header">
                                <div className="printer-status-name">
                                  <span
                                    className={`status-dot ${printer.enabled ? "enabled" : "disabled"}`}
                                  />
                                  <span
                                    className="printer-card-name"
                                    title={printer.nickname || printer.name}
                                  >
                                    {printer.nickname || printer.name}
                                  </span>
                                </div>
                                {isDefaultPr && (
                                  <span className="badge-default">Default</span>
                                )}
                              </div>

                              <div className="printer-item-footer">
                                <span className="printer-driver-text">
                                  {printer.systemName || printer.name}
                                </span>
                                <span
                                  className={`pool-badge pool-${printer.pool || "default"}`}
                                >
                                  {printer.pool?.toUpperCase() || "DEFAULT"}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>

                  {/* Detail Configuration Column */}
                  <div className="printers-detail-pane">
                    {(() => {
                      const selectedPrinter =
                        configuredPrinters.find(
                          (p) =>
                            p.systemName === selectedPrinterKey ||
                            p.name === selectedPrinterKey
                        ) || configuredPrinters[0];

                      if (!selectedPrinter) {
                        return (
                          <div className="detail-empty-selection">
                            <Printer
                              size={36}
                              style={{ opacity: 0.3, marginBottom: 8 }}
                            />
                            <p>
                              Select a printer on the left to configure routing &amp; settings.
                            </p>
                          </div>
                        );
                      }

                      const printerKey =
                        selectedPrinter.systemName || selectedPrinter.name;
                      const testStatus = testPrintStatus[printerKey];
                      const isSystemDef = detectedPrinters.find(
                        (p) => p.name === selectedPrinter.name
                      )?.isDefault;
                      const isDefaultPr =
                        selectedPrinter.isDefault ||
                        defaultPrinterName === selectedPrinter.name;

                      return (
                        <div className="printer-detail-card">
                          {/* Top Detail Header with Actions */}
                          <div className="detail-card-header">
                            <div className="detail-title-group">
                              <div className="detail-name-row">
                                <Printer size={20} className="detail-icon" />
                                <h3 className="detail-printer-title">
                                  {selectedPrinter.nickname || selectedPrinter.name}
                                </h3>
                                {isDefaultPr && (
                                  <span className="badge-default-active">
                                    ★ Default
                                  </span>
                                )}
                                {isSystemDef && (
                                  <span className="badge-os-default">
                                    OS Default
                                  </span>
                                )}
                              </div>
                              <span className="detail-system-name">
                                Queue: {selectedPrinter.systemName || selectedPrinter.name}
                              </span>
                            </div>

                            <div className="detail-actions-group">
                              <button
                                type="button"
                                className="btn-secondary btn-detail-action"
                                onClick={() =>
                                  handleSetDefaultPrinter(selectedPrinter.name)
                                }
                              >
                                {isDefaultPr
                                  ? "★ Default Selected"
                                  : "Set as Default"}
                              </button>

                              <button
                                type="button"
                                className="btn-secondary btn-detail-action"
                                onClick={() => handleTestPrint(selectedPrinter)}
                                disabled={Boolean(testStatus)}
                              >
                                <Printer size={14} />
                                <span>{testStatus || "Test Print"}</span>
                              </button>
                            </div>
                          </div>

                          {/* Configuration Form */}
                          <div className="detail-form-body">
                            {/* Enable / Disable Toggle Switch */}
                            <div className="detail-form-row detail-switch-row">
                              <div>
                                <span className="detail-row-label">
                                  Printer Routing Status
                                </span>
                                <p className="detail-row-desc">
                                  Enable or disable this printer for kiosk jobs.
                                </p>
                              </div>
                              <label className="toggle-switch-label">
                                <input
                                  type="checkbox"
                                  checked={selectedPrinter.enabled}
                                  onChange={(e) =>
                                    handleUpdatePrinterField(printerKey, {
                                      enabled: e.target.checked,
                                    })
                                  }
                                />
                                <span className="toggle-switch-slider" />
                                <span className="toggle-switch-text">
                                  {selectedPrinter.enabled
                                    ? "Enabled"
                                    : "Disabled"}
                                </span>
                              </label>
                            </div>

                            {/* Nickname & Pool Row */}
                            <div className="detail-inputs-grid">
                              <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">
                                  Display Nickname
                                </label>
                                <div
                                  className="input-with-vk"
                                  data-vk-field={`nickname:${printerKey}`}
                                >
                                  <input
                                    type="text"
                                    value={
                                      selectedPrinter.nickname ??
                                      selectedPrinter.name
                                    }
                                    onChange={(e) =>
                                      handleUpdatePrinterField(printerKey, {
                                        nickname: e.target.value,
                                      })
                                    }
                                    placeholder="e.g. Counter B&W Laser"
                                  />
                                  <button
                                    type="button"
                                    className="input-vk-btn"
                                    onClick={() =>
                                      setActiveVk(
                                        activeVk?.field === `nickname:${printerKey}`
                                          ? null
                                          : {
                                              label: "Printer Nickname",
                                              field: `nickname:${printerKey}`,
                                              type: "text",
                                            }
                                      )
                                    }
                                    title="Toggle On-Screen Keyboard"
                                  >
                                    <KeyboardIcon size={14} />
                                  </button>
                                </div>
                              </div>

                              <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">
                                  Pool Assignment
                                </label>
                                <div className="detail-select-wrap">
                                  <select
                                    value={selectedPrinter.pool || "default"}
                                    onChange={(e) =>
                                      handleUpdatePrinterField(printerKey, {
                                        pool: e.target.value as PrinterPoolType,
                                      })
                                    }
                                    className="detail-select"
                                  >
                                    <option value="bw">
                                      B&amp;W Pool (Monochrome)
                                    </option>
                                    <option value="color">Color Pool</option>
                                    <option value="large_format">
                                      Large Format Pool (A3 / Legal)
                                    </option>
                                    <option value="default">
                                      Default Pool (General Routing)
                                    </option>
                                  </select>
                                  <ChevronDown
                                    size={14}
                                    className="detail-select-arrow"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Capabilities Tags */}
                            <div className="detail-capabilities-section">
                              <label className="form-label">
                                Capability Tags (Smart Routing Attributes)
                              </label>
                              <div className="detail-caps-chips">
                                {CAPABILITY_OPTIONS.map((cap) => {
                                  const active =
                                    selectedPrinter.capabilities?.includes(cap);
                                  return (
                                    <button
                                      key={cap}
                                      type="button"
                                      onClick={() =>
                                        handleToggleCapability(printerKey, cap)
                                      }
                                      className={`cap-chip-btn ${active ? "active" : ""}`}
                                    >
                                      <span>{cap}</span>
                                      {active && <Check size={13} />}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: PRICING & PAPER SIZES */}
          {activeTab === "pricing" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <h2
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    margin: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <DollarSign size={22} color="#818cf8" />
                  <span>Pricing &amp; Paper Sizes</span>
                </h2>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    marginTop: 4,
                    marginBottom: 0,
                  }}
                >
                  Set per-page pricing for customers and configure accepted paper sizes.
                </p>
              </div>

              {/* Price per page form */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: 16,
                }}
              >
                <div
                  style={{
                    padding: "20px",
                    borderRadius: "var(--radius-md)",
                    background: "rgba(17, 24, 39, 0.8)",
                    border: "1px solid var(--border-subtle)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  <label className="form-label" style={{ marginBottom: 0 }}>
                    Black &amp; White Price per Page (₹)
                  </label>
                  <div className="input-with-vk" data-vk-field="bwRupees">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      min="0"
                      value={bwRupees}
                      onChange={(e) => setBwRupees(e.target.value)}
                      placeholder="e.g. 2.00"
                    />
                    <button
                      type="button"
                      className="input-vk-btn"
                      onClick={() =>
                        setActiveVk(
                          activeVk?.field === "bwRupees"
                            ? null
                            : {
                                label: "B/W Price (₹)",
                                field: "bwRupees",
                                type: "number",
                              }
                        )
                      }
                      title="Toggle On-Screen Keyboard"
                    >
                      <KeyboardIcon size={16} />
                    </button>
                  </div>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Standard charge for monochrome print jobs.
                  </span>
                </div>

                <div
                  style={{
                    padding: "20px",
                    borderRadius: "var(--radius-md)",
                    background: "rgba(17, 24, 39, 0.8)",
                    border: "1px solid var(--border-subtle)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  <label className="form-label" style={{ marginBottom: 0 }}>
                    Color Price per Page (₹)
                  </label>
                  <div className="input-with-vk" data-vk-field="colorRupees">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      min="0"
                      value={colorRupees}
                      onChange={(e) => setColorRupees(e.target.value)}
                      placeholder="e.g. 10.00"
                    />
                    <button
                      type="button"
                      className="input-vk-btn"
                      onClick={() =>
                        setActiveVk(
                          activeVk?.field === "colorRupees"
                            ? null
                            : {
                                label: "Color Price (₹)",
                                field: "colorRupees",
                                type: "number",
                              }
                        )
                      }
                      title="Toggle On-Screen Keyboard"
                    >
                      <KeyboardIcon size={16} />
                    </button>
                  </div>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Standard charge for full color prints and graphics.
                  </span>
                </div>
              </div>

              {/* Supported Paper Sizes */}
              <div
                style={{
                  padding: "20px",
                  borderRadius: "var(--radius-md)",
                  background: "rgba(17, 24, 39, 0.8)",
                  border: "1px solid var(--border-subtle)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div>
                  <label className="form-label" style={{ marginBottom: 2 }}>
                    Supported Paper Sizes
                  </label>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Select paper sizes your shop has loaded and ready to print.
                  </span>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {["A4", "A3", "Legal", "Letter"].map((size) => {
                    const isChecked = supportedPaperSizes.includes(size);
                    return (
                      <button
                        key={size}
                        type="button"
                        onClick={() => handleTogglePaperSize(size)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "10px 18px",
                          borderRadius: "var(--radius-sm)",
                          fontSize: 14,
                          fontWeight: 600,
                          cursor: "pointer",
                          border: isChecked
                            ? "1px solid var(--accent-primary)"
                            : "1px solid var(--border-subtle)",
                          background: isChecked
                            ? "var(--accent-primary)"
                            : "rgba(15, 23, 42, 0.8)",
                          color: isChecked ? "#ffffff" : "#94a3b8",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <span>{size}</span>
                        {isChecked && <CheckCircle2 size={16} />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Customer Pricing Preview Card */}
              <div
                style={{
                  padding: "16px 20px",
                  borderRadius: "var(--radius-md)",
                  background: "rgba(30, 41, 59, 0.35)",
                  border: "1px dashed var(--border-subtle)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 16,
                }}
              >
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1" }}>
                    Customer Price Preview (Sample 5-page PDF)
                  </span>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                    B&amp;W: ₹{(parseFloat(bwRupees || "0") * 5).toFixed(2)} • Color: ₹
                    {(parseFloat(colorRupees || "0") * 5).toFixed(2)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      background: "rgba(16, 185, 129, 0.15)",
                      color: "#10b981",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    B/W ₹{bwRupees} / page
                  </span>
                  <span
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      background: "rgba(99, 102, 241, 0.15)",
                      color: "#818cf8",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    Color ₹{colorRupees} / page
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: OPERATING MODE */}
          {activeTab === "mode" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <h2
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    margin: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Sliders size={22} color="#818cf8" />
                  <span>Kiosk Operating Mode &amp; Automation</span>
                </h2>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    marginTop: 4,
                    marginBottom: 0,
                  }}
                >
                  Choose between walk-up customer self-service mode and merchant-operated queue.
                </p>
              </div>

              {/* Mode Selection Cards */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: 16,
                }}
              >
                <div
                  onClick={() => setKioskMode("self_service")}
                  style={{
                    padding: "20px",
                    borderRadius: "var(--radius-md)",
                    background:
                      kioskMode === "self_service"
                        ? "rgba(99, 102, 241, 0.15)"
                        : "rgba(17, 24, 39, 0.6)",
                    border:
                      kioskMode === "self_service"
                        ? "2px solid #818cf8"
                        : "1px solid var(--border-subtle)",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    transition: "all 0.15s ease",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ fontSize: 16, fontWeight: 700 }}>
                      Self-Service Kiosk Mode
                    </span>
                    {kioskMode === "self_service" && (
                      <CheckCircle2 size={18} color="#818cf8" />
                    )}
                  </div>
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--text-secondary)",
                      margin: 0,
                      lineHeight: 1.45,
                    }}
                  >
                    Customers walk up, scan QR to upload documents, and enter OTP to print automatically on payment.
                  </p>
                </div>

                <div
                  onClick={() => setKioskMode("owner")}
                  style={{
                    padding: "20px",
                    borderRadius: "var(--radius-md)",
                    background:
                      kioskMode === "owner"
                        ? "rgba(99, 102, 241, 0.15)"
                        : "rgba(17, 24, 39, 0.6)",
                    border:
                      kioskMode === "owner"
                        ? "2px solid #818cf8"
                        : "1px solid var(--border-subtle)",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    transition: "all 0.15s ease",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ fontSize: 16, fontWeight: 700 }}>
                      Owner / Operator Queue Mode
                    </span>
                    {kioskMode === "owner" && (
                      <CheckCircle2 size={18} color="#818cf8" />
                    )}
                  </div>
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--text-secondary)",
                      margin: 0,
                      lineHeight: 1.45,
                    }}
                  >
                    Staff views incoming print jobs in an interactive queue with printer assignments and manual release.
                  </p>
                </div>
              </div>

              {/* Rush Hour Auto-Print Card - ONLY in Owner Mode */}
              {kioskMode === "owner" ? (
                <div
                  style={{
                    padding: "20px",
                    borderRadius: "var(--radius-md)",
                    background: rushHourAutoPrint
                      ? "rgba(245, 158, 11, 0.12)"
                      : "rgba(17, 24, 39, 0.8)",
                    border: rushHourAutoPrint
                      ? "1px solid rgba(245, 158, 11, 0.4)"
                      : "1px solid var(--border-subtle)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 16,
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: "var(--radius-sm)",
                        background: rushHourAutoPrint
                          ? "rgba(245, 158, 11, 0.25)"
                          : "rgba(30, 41, 59, 0.6)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: rushHourAutoPrint ? "#f59e0b" : "#94a3b8",
                      }}
                    >
                      <Zap size={24} />
                    </div>
                    <div>
                      <span
                        style={{
                          fontSize: 16,
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span>⚡ Rush Hour Auto-Print</span>
                        {rushHourAutoPrint && (
                          <span
                            style={{
                              fontSize: 11,
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: "rgba(245, 158, 11, 0.2)",
                              color: "#f59e0b",
                              fontWeight: 600,
                            }}
                          >
                            ACTIVE IN OWNER MODE
                          </span>
                        )}
                      </span>
                      <p
                        style={{
                          fontSize: 13,
                          color: "var(--text-secondary)",
                          margin: "4px 0 0 0",
                        }}
                      >
                        In Owner Mode, automatically sends incoming cloud jobs straight to routed printer pools without requiring manual OTP confirmation.
                      </p>
                    </div>
                  </div>

                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 10,
                      cursor: "pointer",
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={rushHourAutoPrint}
                      onChange={(e) => setRushHourAutoPrint(e.target.checked)}
                      style={{
                        width: 22,
                        height: 22,
                        accentColor: "#f59e0b",
                        cursor: "pointer",
                      }}
                    />
                    <span>
                      {rushHourAutoPrint ? "Auto-Print Enabled" : "Disabled"}
                    </span>
                  </label>
                </div>
              ) : (
                <div
                  style={{
                    padding: "16px 20px",
                    borderRadius: "var(--radius-md)",
                    background: "rgba(15, 23, 42, 0.45)",
                    border: "1px dashed rgba(148, 163, 184, 0.2)",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    color: "var(--text-muted)",
                    fontSize: 13,
                  }}
                >
                  <Zap size={18} style={{ opacity: 0.5, flexShrink: 0 }} />
                  <span>
                    <strong>Rush Hour Auto-Print</strong> is only available in <strong>Owner / Operator Queue Mode</strong>. In Self-Service Kiosk Mode, customers must enter their 6-digit OTP at the screen to release prints.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: CLOUD RELAY */}
          {activeTab === "relay" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <h2
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    margin: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Cloud size={22} color="#818cf8" />
                  <span>Cloud Relay &amp; Network Configuration</span>
                </h2>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    marginTop: 4,
                    marginBottom: 0,
                  }}
                >
                  Manage the WebSocket relay connection and local storage location for customer files.
                </p>
              </div>

              {/* Status Banner */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "16px 20px",
                  borderRadius: "var(--radius-md)",
                  background:
                    kioskState.relayStatus === "connected"
                      ? "rgba(16, 185, 129, 0.12)"
                      : "rgba(245, 158, 11, 0.12)",
                  border:
                    kioskState.relayStatus === "connected"
                      ? "1px solid rgba(16, 185, 129, 0.3)"
                      : "1px solid rgba(245, 158, 11, 0.3)",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      background:
                        kioskState.relayStatus === "connected"
                          ? "#10b981"
                          : "#f59e0b",
                    }}
                  />
                  <div>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>
                      Relay Status: {kioskState.relayStatus.toUpperCase()}
                    </span>
                    {kioskState.relayMessage && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--text-secondary)",
                          marginTop: 2,
                        }}
                      >
                        {kioskState.relayMessage}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleReconnectRelay}
                  disabled={reconnectingRelay}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <RefreshCw
                    size={15}
                    className={reconnectingRelay ? "spin" : ""}
                  />
                  <span>Reconnect Relay</span>
                </button>
              </div>

              {/* Server URL Input */}
              <div
                style={{
                  padding: "20px",
                  borderRadius: "var(--radius-md)",
                  background: "rgba(17, 24, 39, 0.8)",
                  border: "1px solid var(--border-subtle)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <label className="form-label" style={{ marginBottom: 0 }}>
                  Cloud Relay Server URL
                </label>
                <div className="input-with-vk" data-vk-field="relayUrl">
                  <input
                    type="url"
                    inputMode="url"
                    value={relayUrl}
                    onChange={(e) => setRelayUrl(e.target.value)}
                    placeholder="https://relay.yourdomain.com"
                  />
                  <button
                    type="button"
                    className="input-vk-btn"
                    onClick={() =>
                      setActiveVk(
                        activeVk?.field === "relayUrl"
                          ? null
                          : {
                              label: "Cloud Relay URL",
                              field: "relayUrl",
                              type: "url",
                            }
                      )
                    }
                    title="Toggle On-Screen Keyboard"
                  >
                    <KeyboardIcon size={16} />
                  </button>
                </div>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  The backend relay machine that receives uploads from customer phones.
                </span>
              </div>

              {/* Storage Folder */}
              <div
                style={{
                  padding: "20px",
                  borderRadius: "var(--radius-md)",
                  background: "rgba(17, 24, 39, 0.8)",
                  border: "1px solid var(--border-subtle)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <label className="form-label" style={{ marginBottom: 0 }}>
                  Storage Folder Location
                </label>
                <div style={{ display: "flex", gap: 10 }}>
                  <div
                    className="input-with-vk"
                    data-vk-field="storageFolder"
                    style={{ flex: 1 }}
                  >
                    <input
                      type="text"
                      value={storageFolder}
                      onChange={(e) => setStorageFolder(e.target.value)}
                      placeholder="Application data storage directory"
                    />
                    <button
                      type="button"
                      className="input-vk-btn"
                      onClick={() =>
                        setActiveVk(
                          activeVk?.field === "storageFolder"
                            ? null
                            : {
                                label: "Storage Folder",
                                field: "storageFolder",
                                type: "text",
                              }
                        )
                      }
                      title="Toggle On-Screen Keyboard"
                    >
                      <KeyboardIcon size={16} />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() =>
                      pickStorageFolder()
                        .then((p) => {
                          if (p) setStorageFolder(p);
                        })
                        .catch(() => {})
                    }
                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <FolderOpen size={16} />
                    <span>Browse...</span>
                  </button>
                </div>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Active path:{" "}
                  <code style={{ color: "#c7d2fe" }}>
                    {storageFolder.trim()
                      ? resolveStoragePreviewPath(storageFolder)
                      : "JetPrint KIOSK"}
                  </code>
                </span>
              </div>

              {/* Machine Identity & Re-register */}
              <div
                style={{
                  padding: "16px 20px",
                  borderRadius: "var(--radius-md)",
                  background: "rgba(15, 23, 42, 0.6)",
                  border: "1px solid var(--border-subtle)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    Machine Registration Token
                  </span>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    ID: <code style={{ color: "#a5b4fc" }}>{kioskState.machineId}</code>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleReRegisterMachine}
                  disabled={reRegistering}
                  style={{
                    color: "var(--danger)",
                    borderColor: "rgba(239, 68, 68, 0.3)",
                  }}
                >
                  {reRegistering ? "Re-registering..." : "Re-register Machine"}
                </button>
              </div>
            </div>
          )}

          {/* TAB 5: SYSTEM & UPDATES */}
          {activeTab === "system" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <h2
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    margin: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Cpu size={22} color="#818cf8" />
                  <span>System, Window &amp; Updates</span>
                </h2>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    marginTop: 4,
                    marginBottom: 0,
                  }}
                >
                  Manage application version updates, fullscreen display mode, and inspect logs.
                </p>
              </div>

              {/* Version & Update Banner */}
              <div
                style={{
                  padding: "20px",
                  borderRadius: "var(--radius-md)",
                  background: "rgba(17, 24, 39, 0.8)",
                  border: "1px solid var(--border-subtle)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <div>
                    <span className="form-label" style={{ marginBottom: 2 }}>
                      JetPrint Kiosk Application Version
                    </span>
                    <span
                      style={{
                        fontSize: 16,
                        fontFamily: "monospace",
                        color: "#c7d2fe",
                        fontWeight: 700,
                      }}
                    >
                      {currentVersion ? `v${currentVersion}` : "v0.1.0"}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleCheckForUpdates}
                    disabled={checkingUpdates || installingUpdate}
                    style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                  >
                    {checkingUpdates ? (
                      <>
                        <Loader2 size={16} className="spin" />
                        <span>Checking...</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw size={16} />
                        <span>Check for Updates</span>
                      </>
                    )}
                  </button>
                </div>

                {availableUpdate && (
                  <div
                    style={{
                      padding: "16px",
                      borderRadius: "var(--radius-sm)",
                      background: "rgba(99, 102, 241, 0.15)",
                      border: "1px solid #818cf8",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <DownloadCloud size={20} color="#818cf8" />
                      <span style={{ fontSize: 14, fontWeight: 600 }}>
                        Update Available: Version {availableUpdate.version}
                      </span>
                    </div>

                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleInstallUpdate}
                      disabled={installingUpdate}
                    >
                      {installingUpdate ? (
                        <>
                          <Loader2 size={16} className="spin" />
                          <span>Installing...</span>
                        </>
                      ) : (
                        <span>Install Update &amp; Restart</span>
                      )}
                    </button>
                  </div>
                )}

                {!availableUpdate && !checkingUpdates && checkedUpToDate && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      color: "var(--success)",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    <CheckCircle2 size={16} /> Up to date (v{currentVersion || "current"})
                  </span>
                )}

                {checkError && (
                  <span style={{ color: "var(--danger)", fontSize: 13 }}>
                    {checkError}
                  </span>
                )}
                {updateError && (
                  <span style={{ color: "var(--danger)", fontSize: 13 }}>
                    {updateError}
                  </span>
                )}
              </div>

              {/* Display & Window Options */}
              <div
                style={{
                  padding: "20px",
                  borderRadius: "var(--radius-md)",
                  background: "rgba(17, 24, 39, 0.8)",
                  border: "1px solid var(--border-subtle)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 16,
                }}
              >
                <div>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>
                    Fullscreen Kiosk Mode
                  </span>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--text-secondary)",
                      marginTop: 2,
                    }}
                  >
                    {isFullscreenLocal
                      ? "Currently active in Fullscreen Kiosk mode."
                      : "Currently in Windowed desktop mode."}
                  </div>
                </div>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleToggleFullscreen}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                >
                  {isFullscreenLocal ? (
                    <>
                      <Minimize size={16} />
                      <span>Exit Fullscreen</span>
                    </>
                  ) : (
                    <>
                      <Maximize size={16} />
                      <span>Enter Fullscreen</span>
                    </>
                  )}
                </button>
              </div>

              {/* Diagnostics & Logs Viewer */}
              <div
                style={{
                  padding: "20px",
                  borderRadius: "var(--radius-md)",
                  background: "rgba(17, 24, 39, 0.8)",
                  border: "1px solid var(--border-subtle)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 16,
                }}
              >
                <div>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>
                    Application Diagnostics &amp; Logs
                  </span>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--text-secondary)",
                      marginTop: 2,
                    }}
                  >
                    Inspect real-time kiosk logs, print job dispatches, and relay events.
                  </div>
                </div>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => openLogsWindow().catch(() => {})}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                >
                  <FileText size={16} />
                  <span>Open Logs Window</span>
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Touch Screen Virtual Keyboard */}
      {activeVk && (
        <div
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <VirtualKeyboard
            label={activeVk.label}
            value={getVkValue()}
            onChange={handleVkChange}
            onClose={() => setActiveVk(null)}
            type={activeVk.type}
          />
        </div>
      )}
    </div>
  );
};
