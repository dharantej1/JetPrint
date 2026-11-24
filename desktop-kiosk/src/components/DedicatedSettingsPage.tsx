import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  Printer,
  Search,
  X,
  LayoutGrid,
  List,
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


const detectPrinterCapabilities = (name: string, driverName?: string): string[] => {
  const combined = `${name} ${driverName || ""}`.toLowerCase();
  const caps: string[] = ["A4"];
  const isColor =
    combined.includes("color") ||
    combined.includes("colour") ||
    combined.includes("deskjet") ||
    combined.includes("inktank") ||
    combined.includes("ink tank") ||
    combined.includes("ecotank") ||
    combined.includes("eco tank") ||
    combined.includes("l3250") ||
    combined.includes("l3150") ||
    combined.includes("pixma") ||
    combined.includes("photo") ||
    combined.includes("officejet") ||
    combined.includes("stylus");

  caps.push("B&W");
  if (isColor) {
    caps.push("Color");
  }
  if (
    combined.includes("a3") ||
    combined.includes("plotter") ||
    combined.includes("designjet") ||
    combined.includes("large")
  ) {
    caps.push("A3");
  }
  if (combined.includes("legal")) {
    caps.push("Legal");
  }
  return caps;
};

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
  
  const [printerFilter, setPrinterFilter] = useState<string>("all");
  const [printerSearchQuery, setPrinterSearchQuery] = useState<string>("");
  const [printerDensity, setPrinterDensity] = useState<"comfortable" | "compact">("comfortable");

  const handleTogglePrintMode = (systemName: string, mode: "B&W" | "Color") => {
    setConfiguredPrinters((prev) =>
      prev.map((p) => {
        if (p.systemName === systemName || p.name === systemName) {
          const hasMode = p.capabilities.some(
            (c) => c.toLowerCase() === mode.toLowerCase()
          );
          let nextCaps: string[];
          if (hasMode) {
            const otherMode = mode === "B&W" ? "Color" : "B&W";
            const hasOther = p.capabilities.some(
              (c) => c.toLowerCase() === otherMode.toLowerCase()
            );
            if (!hasOther) return p;
            nextCaps = p.capabilities.filter(
              (c) => c.toLowerCase() !== mode.toLowerCase()
            );
          } else {
            nextCaps = [...p.capabilities, mode];
          }
          return { ...p, capabilities: nextCaps };
        }
        return p;
      })
    );
  };

  const handleTogglePaperTray = (systemName: string, size: string) => {
    setConfiguredPrinters((prev) =>
      prev.map((p) => {
        if (p.systemName === systemName || p.name === systemName) {
          const hasSize = p.capabilities.includes(size);
          let nextCaps: string[];
          if (hasSize) {
            const otherSizes = p.capabilities.filter((c) =>
              ["A4", "Legal", "Letter", "A3"].includes(c)
            );
            if (otherSizes.length <= 1) return p;
            nextCaps = p.capabilities.filter((c) => c !== size);
          } else {
            nextCaps = [...p.capabilities, size];
          }
          return { ...p, capabilities: nextCaps };
        }
        return p;
      })
    );
  };

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

  // Auto-resolve reconnecting message when relay status updates
  useEffect(() => {
    if (saveSuccessMessage === "Reconnecting to relay...") {
      if (kioskState.relayStatus === "connected" || kioskState.relayConnected) {
        setSaveSuccessMessage("Relay connected.");
        const t = setTimeout(() => {
          setSaveSuccessMessage((prev) =>
            prev === "Relay connected." ? "" : prev
          );
        }, 3000);
        return () => clearTimeout(t);
      } else if (kioskState.relayStatus === "error") {
        setSaveErrorMessage(
          kioskState.relayMessage || "Relay connection failed."
        );
        setSaveSuccessMessage("");
      }
    }
  }, [
    kioskState.relayStatus,
    kioskState.relayConnected,
    saveSuccessMessage,
    kioskState.relayMessage,
  ]);

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
          const autoCaps = detectPrinterCapabilities(p.name, p.systemName);
          return {
            id: p.systemName || p.name,
            systemName: p.systemName || p.name,
            name: p.name,
            nickname: p.name,
            enabled: true,
            capabilities: autoCaps,
            pool: (isDef ? "default" : autoCaps.includes("Color") ? "color" : "bw") as PrinterPoolType,
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
    if (updates.enabled === false && activeVk?.field === `nickname:${systemName}`) {
      setActiveVk(null);
    }
    setConfiguredPrinters((prev) =>
      prev.map((p) =>
        p.systemName === systemName || p.name === systemName
          ? { ...p, ...updates }
          : p
      )
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

      onStateUpdated({ ...updated, configuredPrinters });
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
      setTimeout(() => {
        setSaveSuccessMessage((prev) =>
          prev === "Machine identity re-registered successfully." ? "" : prev
        );
      }, 4000);
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
      setTimeout(() => {
        setSaveSuccessMessage((prev) =>
          prev === "Reconnecting to relay..." ? "" : prev
        );
      }, 6000);
    } catch (err) {
      setSaveErrorMessage(
        typeof err === "string" ? err : "Relay connection failed."
      );
      setSaveSuccessMessage("");
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
              {saveSuccessMessage === "Reconnecting to relay..." ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <CheckCircle2 size={15} />
              )}
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
          {/* TAB 1: PRINTERS & CAPABILITIES (MINIMALIST SINGLE-VIEW BENTO ROWS) */}
          {activeTab === "printers" && (() => {
            const activePrinters = configuredPrinters.filter((p) => p.enabled);
            const bwActiveCount = activePrinters.filter(
              (p) =>
                p.capabilities.some(
                  (c) => c.toLowerCase() === "b&w" || c.toLowerCase() === "bw"
                ) || p.pool === "bw"
            ).length;
            const colorActiveCount = activePrinters.filter(
              (p) =>
                p.capabilities.some((c) => c.toLowerCase() === "color") ||
                p.pool === "color"
            ).length;
            const readyPaperSizes = ["A4", "Legal", "Letter", "A3"].filter((size) =>
              activePrinters.some((p) => p.capabilities.includes(size))
            );

            const filteredPrinters = configuredPrinters.filter((p) => {
              if (printerSearchQuery.trim()) {
                const q = printerSearchQuery.toLowerCase().trim();
                const nameMatch = (p.name || "").toLowerCase().includes(q);
                const nicknameMatch = (p.nickname || "").toLowerCase().includes(q);
                const systemMatch = (p.systemName || "").toLowerCase().includes(q);
                const capMatch = p.capabilities.some((c) => c.toLowerCase().includes(q));
                if (!nameMatch && !nicknameMatch && !systemMatch && !capMatch) {
                  return false;
                }
              }

              if (printerFilter === "bw") {
                return (
                  p.capabilities.some(
                    (c) => c.toLowerCase() === "b&w" || c.toLowerCase() === "bw"
                  ) || p.pool === "bw"
                );
              }
              if (printerFilter === "color") {
                return (
                  p.capabilities.some((c) => c.toLowerCase() === "color") ||
                  p.pool === "color"
                );
              }
              if (printerFilter === "large") {
                return (
                  p.capabilities.some(
                    (c) => c.toLowerCase() === "a3" || c.toLowerCase() === "legal"
                  ) || p.pool === "large_format"
                );
              }
              return true;
            });

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {/* Minimal Header */}
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
                      <span>Printers &amp; Capabilities</span>
                    </h2>
                    <p
                      style={{
                        fontSize: 13,
                        color: "var(--text-secondary)",
                        marginTop: 4,
                        marginBottom: 0,
                      }}
                    >
                      Manage connected hardware, capabilities, and automatic print distribution.
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

                {/* Minimalist Status Strip */}
                <div className="minimal-status-strip">
                  <div className="status-strip-left">
                    <div className="status-strip-item">
                      <span
                        className={`status-indicator-dot ${
                          bwActiveCount > 0 ? "dot-online" : "dot-warning"
                        }`}
                      />
                      <span className="status-strip-text">
                        <strong>{bwActiveCount}</strong> B&amp;W Ready
                        {bwActiveCount > 1 && (
                          <span className="strip-badge-balanced">
                            Auto-Balanced
                          </span>
                        )}
                      </span>
                    </div>

                    <span className="status-strip-divider" />

                    <div className="status-strip-item">
                      <span
                        className={`status-indicator-dot ${
                          colorActiveCount > 0 ? "dot-online" : "dot-muted"
                        }`}
                      />
                      <span className="status-strip-text">
                        <strong>{colorActiveCount}</strong> Color Ready
                        {colorActiveCount > 1 && (
                          <span className="strip-badge-balanced">
                            Auto-Balanced
                          </span>
                        )}
                      </span>
                    </div>

                    <span className="status-strip-divider" />

                    <div className="status-strip-item">
                      <Sliders size={13} style={{ opacity: 0.6 }} />
                      <span className="status-strip-text">
                        Trays:{" "}
                        <strong>
                          {readyPaperSizes.length > 0
                            ? readyPaperSizes.join(", ")
                            : "None"}
                        </strong>
                      </span>
                    </div>
                  </div>

                  <div className="status-strip-right">
                    <span className="status-strip-count">
                      {activePrinters.length} of {configuredPrinters.length} Online
                    </span>
                  </div>
                </div>

                {/* Integrated Toolbar: Search, Filters & View Density (Always Visible) */}
                <div className="printers-integrated-toolbar">
                  {/* Search Input */}
                  <div className="toolbar-search-wrap">
                    <Search size={14} className="toolbar-search-icon" />
                    <input
                      type="text"
                      className="toolbar-search-input"
                      placeholder="Search by printer name or model..."
                      value={printerSearchQuery}
                      onChange={(e) => setPrinterSearchQuery(e.target.value)}
                    />
                    {printerSearchQuery && (
                      <button
                        type="button"
                        className="toolbar-search-clear"
                        onClick={() => setPrinterSearchQuery("")}
                        title="Clear search"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>

                  {/* Filter Pills (Always Available) */}
                  <div className="toolbar-filter-pills">
                    <button
                      type="button"
                      className={`minimal-tab-btn ${
                        printerFilter === "all" ? "active" : ""
                      }`}
                      onClick={() => setPrinterFilter("all")}
                    >
                      <span>All</span>
                      <span className="minimal-tab-count">
                        {configuredPrinters.length}
                      </span>
                    </button>

                    <button
                      type="button"
                      className={`minimal-tab-btn ${
                        printerFilter === "bw" ? "active" : ""
                      }`}
                      onClick={() => setPrinterFilter("bw")}
                    >
                      <span>B&amp;W</span>
                      <span className="minimal-tab-count">
                        {
                          configuredPrinters.filter(
                            (p) =>
                              p.capabilities.some(
                                (c) =>
                                  c.toLowerCase() === "b&w" ||
                                  c.toLowerCase() === "bw"
                              ) || p.pool === "bw"
                          ).length
                        }
                      </span>
                    </button>

                    <button
                      type="button"
                      className={`minimal-tab-btn ${
                        printerFilter === "color" ? "active" : ""
                      }`}
                      onClick={() => setPrinterFilter("color")}
                    >
                      <span>Color</span>
                      <span className="minimal-tab-count">
                        {
                          configuredPrinters.filter(
                            (p) =>
                              p.capabilities.some(
                                (c) => c.toLowerCase() === "color"
                              ) || p.pool === "color"
                          ).length
                        }
                      </span>
                    </button>

                    <button
                      type="button"
                      className={`minimal-tab-btn ${
                        printerFilter === "large" ? "active" : ""
                      }`}
                      onClick={() => setPrinterFilter("large")}
                    >
                      <span>Large Paper</span>
                      <span className="minimal-tab-count">
                        {
                          configuredPrinters.filter(
                            (p) =>
                              p.capabilities.some(
                                (c) =>
                                  c.toLowerCase() === "a3" ||
                                  c.toLowerCase() === "legal"
                              ) || p.pool === "large_format"
                          ).length
                        }
                      </span>
                    </button>
                  </div>

                  {/* Density Switcher */}
                  <div className="toolbar-density-switcher">
                    <button
                      type="button"
                      className={`density-switch-btn ${
                        printerDensity === "comfortable" ? "active" : ""
                      }`}
                      onClick={() => setPrinterDensity("comfortable")}
                      title="Comfortable bento cards"
                    >
                      <LayoutGrid size={13} />
                      <span>Comfortable</span>
                    </button>

                    <button
                      type="button"
                      className={`density-switch-btn ${
                        printerDensity === "compact" ? "active" : ""
                      }`}
                      onClick={() => setPrinterDensity("compact")}
                      title="Compact table rows for large fleet"
                    >
                      <List size={13} />
                      <span>Compact</span>
                    </button>
                  </div>
                </div>

                {/* Printer List: Comfortable Bento vs Compact Single-Line Rows */}
                {configuredPrinters.length === 0 ? (
                  <div className="printers-empty-panel">
                    <p>
                      {loadingPrinters
                        ? "Scanning for connected printers..."
                        : "No printers detected. Connect a printer or click 'Rescan System Printers'."}
                    </p>
                  </div>
                ) : filteredPrinters.length === 0 ? (
                  <div
                    className="printers-empty-panel"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 14 }}>
                      {printerSearchQuery.trim()
                        ? `No printers matching "${printerSearchQuery}".`
                        : printerFilter === "color"
                        ? 'No color printers found. Check "Color & Photos" on any printer to accept color jobs.'
                        : printerFilter === "bw"
                        ? 'No black & white printers found. Check "Black & White" on any printer to accept monochrome jobs.'
                        : printerFilter === "large"
                        ? 'No large paper printers found. Check "A3" or "Legal" on any printer to accept large format jobs.'
                        : "No printers found."}
                    </p>
                    {printerSearchQuery.trim() ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setPrinterSearchQuery("")}
                        style={{
                          padding: "6px 14px",
                          fontSize: 13,
                          borderRadius: "var(--radius-sm)",
                        }}
                      >
                        Clear Search
                      </button>
                    ) : printerFilter !== "all" ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setPrinterFilter("all")}
                        style={{
                          padding: "6px 14px",
                          fontSize: 13,
                          borderRadius: "var(--radius-sm)",
                        }}
                      >
                        Show All Printers
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          setPrinterSearchQuery("");
                          setPrinterFilter("all");
                        }}
                        style={{
                          padding: "6px 14px",
                          fontSize: 13,
                          borderRadius: "var(--radius-sm)",
                        }}
                      >
                        Reset Filters
                      </button>
                    )}
                  </div>
                ) : printerDensity === "compact" ? (
                  /* COMPACT MODE: Single-Line Rows for High-Volume Fleets */
                  <div className="printers-compact-list">
                    {filteredPrinters.map((printer) => {
                      const printerKey = printer.systemName || printer.name;
                      const isDefaultPr =
                        printer.isDefault || defaultPrinterName === printer.name;
                      const isSystemDef = detectedPrinters.find(
                        (p) => p.name === printer.name
                      )?.isDefault;
                      const testStatus = testPrintStatus[printerKey];

                      const isBwSelected = printer.capabilities.some(
                        (c) =>
                          c.toLowerCase() === "b&w" || c.toLowerCase() === "bw"
                      );
                      const isColorSelected = printer.capabilities.some(
                        (c) => c.toLowerCase() === "color"
                      );

                      return (
                        <div
                          key={printerKey}
                          className={`printer-compact-row ${
                            !printer.enabled ? "is-disabled" : ""
                          }`}
                        >
                          <div className="compact-left">
                            <span
                              className={`status-indicator-dot ${
                                printer.enabled ? "dot-online" : "dot-disabled"
                              }`}
                              title={
                                printer.enabled
                                  ? "Printer Online & Active"
                                  : "Printer Disabled"
                              }
                            />

                            <div
                              className={`compact-name-wrap ${!printer.enabled ? "disabled" : ""}`}
                              data-vk-field={`nickname:${printerKey}`}
                            >
                              <input
                                type="text"
                                className="compact-name-input"
                                disabled={!printer.enabled}
                                style={{
                                  width: `${Math.max(
                                    (printer.nickname || printer.name).length + 3,
                                    26
                                  )}ch`,
                                  maxWidth: "100%",
                                }}
                                value={printer.nickname ?? printer.name}
                                onChange={(e) =>
                                  handleUpdatePrinterField(printerKey, {
                                    nickname: e.target.value,
                                  })
                                }
                                placeholder="Printer Name"
                                title={
                                  printer.enabled
                                    ? printer.nickname ?? printer.name
                                    : "Printer Disabled"
                                }
                              />
                              <button
                                type="button"
                                className="bento-vk-btn"
                                disabled={!printer.enabled}
                                onClick={() => {
                                  if (!printer.enabled) return;
                                  setActiveVk(
                                    activeVk?.field ===
                                      `nickname:${printerKey}`
                                      ? null
                                      : {
                                          label: "Printer Nickname",
                                          field: `nickname:${printerKey}`,
                                          type: "text",
                                        }
                                  );
                                }}
                                title={
                                  printer.enabled
                                    ? "On-Screen Keyboard"
                                    : "Printer Disabled"
                                }
                              >
                                <KeyboardIcon size={12} />
                              </button>
                            </div>

                            {/* Only show Queue badge if nickname is different from systemName/name */}
                            {Boolean(
                              printer.nickname &&
                                printer.nickname !== (printer.systemName || printer.name)
                            ) && (
                              <span
                                className="compact-queue-badge"
                                title={`Queue: ${
                                  printer.systemName || printer.name
                                }`}
                              >
                                {printer.systemName || printer.name}
                              </span>
                            )}

                            {isDefaultPr && (
                              <span className="bento-badge-default">
                                ★ Default
                              </span>
                            )}
                            {isSystemDef && (
                              <span className="bento-badge-os-default">
                                OS Default
                              </span>
                            )}
                          </div>

                          <div className="compact-center">
                            <div className="compact-pills-group">
                              <button
                                type="button"
                                disabled={!printer.enabled}
                                className={`compact-pill ${
                                  isBwSelected ? "active" : ""
                                }`}
                                onClick={() =>
                                  handleTogglePrintMode(printerKey, "B&W")
                                }
                                title="Toggle B&W"
                              >
                                {isBwSelected && <Check size={10} />}
                                <span>B&amp;W</span>
                              </button>

                              <button
                                type="button"
                                disabled={!printer.enabled}
                                className={`compact-pill ${
                                  isColorSelected ? "active" : ""
                                }`}
                                onClick={() =>
                                  handleTogglePrintMode(printerKey, "Color")
                                }
                                title="Toggle Color"
                              >
                                {isColorSelected && <Check size={10} />}
                                <span>Color</span>
                              </button>
                            </div>

                            <div className="compact-pills-group compact-trays">
                              {["A4", "Legal", "Letter", "A3"].map(
                                (size) => {
                                  const isChecked =
                                    printer.capabilities.includes(size);
                                  return (
                                    <button
                                      key={size}
                                      type="button"
                                      disabled={!printer.enabled}
                                      className={`compact-tray-chip ${
                                        isChecked ? "active" : ""
                                      }`}
                                      onClick={() =>
                                        handleTogglePaperTray(printerKey, size)
                                      }
                                      title={`Toggle ${size}`}
                                    >
                                      {isChecked && <Check size={9} />}
                                      <span>{size}</span>
                                    </button>
                                  );
                                }
                              )}
                            </div>
                          </div>

                          <div className="compact-right">
                            {!isDefaultPr && printer.enabled && (
                              <button
                                type="button"
                                className="bento-action-btn compact-action-btn"
                                onClick={() =>
                                  handleSetDefaultPrinter(printer.name)
                                }
                                title="Set as primary default"
                              >
                                Make Default
                              </button>
                            )}

                            <button
                              type="button"
                              className="bento-action-btn bento-test-btn compact-action-btn"
                              onClick={() => handleTestPrint(printer)}
                              disabled={
                                Boolean(testStatus) || !printer.enabled
                              }
                              title="Send test print"
                            >
                              <Printer size={12} />
                              <span>{testStatus || "Test"}</span>
                            </button>

                            <label
                              className="bento-switch compact-switch"
                              title={
                                printer.enabled
                                  ? "Disable printer"
                                  : "Enable printer"
                              }
                            >
                              <input
                                type="checkbox"
                                checked={printer.enabled}
                                onChange={(e) =>
                                  handleUpdatePrinterField(printerKey, {
                                    enabled: e.target.checked,
                                  })
                                }
                              />
                              <span className="bento-switch-slider" />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* COMFORTABLE MODE: Full-width Bento Cards with Complete Names */
                  <div className="printers-bento-list">
                    {filteredPrinters.map((printer) => {
                      const printerKey = printer.systemName || printer.name;
                      const isDefaultPr =
                        printer.isDefault || defaultPrinterName === printer.name;
                      const isSystemDef = detectedPrinters.find(
                        (p) => p.name === printer.name
                      )?.isDefault;
                      const testStatus = testPrintStatus[printerKey];

                      const isBwSelected = printer.capabilities.some(
                        (c) =>
                          c.toLowerCase() === "b&w" || c.toLowerCase() === "bw"
                      );
                      const isColorSelected = printer.capabilities.some(
                        (c) => c.toLowerCase() === "color"
                      );

                      return (
                        <div
                          key={printerKey}
                          className={`printer-bento-card ${
                            !printer.enabled ? "is-disabled" : ""
                          }`}
                        >
                          {/* Row Header: Full Model Name, Badges & Actions */}
                          <div className="bento-card-header">
                            <div className="bento-header-left">
                              <span
                                className={`status-indicator-dot ${
                                  printer.enabled ? "dot-online" : "dot-disabled"
                                }`}
                                title={
                                  printer.enabled
                                    ? "Printer Online & Active"
                                    : "Printer Disabled"
                                }
                              />

                              {/* Auto-Sizing Full Model Name */}
                              <div
                                className={`bento-nickname-wrap ${!printer.enabled ? "disabled" : ""}`}
                                data-vk-field={`nickname:${printerKey}`}
                              >
                                <input
                                  type="text"
                                  className="bento-nickname-input"
                                  disabled={!printer.enabled}
                                  style={{
                                    width: `${Math.max(
                                      (printer.nickname || printer.name).length + 3,
                                      26
                                    )}ch`,
                                    maxWidth: "100%",
                                  }}
                                  value={printer.nickname ?? printer.name}
                                  onChange={(e) =>
                                    handleUpdatePrinterField(printerKey, {
                                      nickname: e.target.value,
                                    })
                                  }
                                  placeholder="Printer Name"
                                  title={
                                    printer.enabled
                                      ? "Click to rename"
                                      : "Printer Disabled"
                                  }
                                />
                                <button
                                  type="button"
                                  className="bento-vk-btn"
                                  disabled={!printer.enabled}
                                  onClick={() => {
                                    if (!printer.enabled) return;
                                    setActiveVk(
                                      activeVk?.field ===
                                        `nickname:${printerKey}`
                                        ? null
                                        : {
                                            label: "Printer Nickname",
                                            field: `nickname:${printerKey}`,
                                            type: "text",
                                          }
                                    );
                                  }}
                                  title={
                                    printer.enabled
                                      ? "On-Screen Keyboard"
                                      : "Printer Disabled"
                                  }
                                >
                                  <KeyboardIcon size={13} />
                                </button>
                              </div>

                              {/* Queue Driver Badge - only show if nickname is different from systemName/name */}
                              {Boolean(
                                printer.nickname &&
                                  printer.nickname !== (printer.systemName || printer.name)
                              ) && (
                                <span
                                  className="bento-queue-badge"
                                  title={`System Queue: ${
                                    printer.systemName || printer.name
                                  }`}
                                >
                                  Queue: {printer.systemName || printer.name}
                                </span>
                              )}

                              {/* Default / OS Default Badges */}
                              {isDefaultPr && (
                                <span className="bento-badge-default">
                                  ★ Default
                                </span>
                              )}
                              {isSystemDef && (
                                <span className="bento-badge-os-default">
                                  OS Default
                                </span>
                              )}
                            </div>

                            {/* Header Right Actions */}
                            <div className="bento-header-right">
                              {!isDefaultPr && printer.enabled && (
                                <button
                                  type="button"
                                  className="bento-action-btn"
                                  onClick={() =>
                                    handleSetDefaultPrinter(printer.name)
                                  }
                                  title="Set as primary default printer"
                                >
                                  Make Default
                                </button>
                              )}

                              <button
                                type="button"
                                className="bento-action-btn bento-test-btn"
                                onClick={() => handleTestPrint(printer)}
                                disabled={
                                  Boolean(testStatus) || !printer.enabled
                                }
                                title="Send test print"
                              >
                                <Printer size={13} />
                                <span>{testStatus || "Test Print"}</span>
                              </button>

                              <label
                                className="bento-switch"
                                title={
                                  printer.enabled
                                    ? "Disable this printer"
                                    : "Enable this printer"
                                }
                              >
                                <input
                                  type="checkbox"
                                  checked={printer.enabled}
                                  onChange={(e) =>
                                    handleUpdatePrinterField(printerKey, {
                                      enabled: e.target.checked,
                                    })
                                  }
                                />
                                <span className="bento-switch-slider" />
                              </label>
                            </div>
                          </div>

                          {/* Hairline Divider */}
                          <div className="bento-card-divider" />

                          {/* Row Body: Direct 2-Column Capability Grid */}
                          <div className="bento-card-body">
                            {/* Column 1: Print Modes */}
                            <div className="bento-group">
                              <span className="bento-group-label">
                                Print Modes
                              </span>
                              <div className="bento-pills-row">
                                <button
                                  type="button"
                                  disabled={!printer.enabled}
                                  className={`bento-mode-pill ${
                                    isBwSelected ? "active" : ""
                                  }`}
                                  onClick={() =>
                                    handleTogglePrintMode(printerKey, "B&W")
                                  }
                                >
                                  <div className="bento-pill-check">
                                    {isBwSelected && <Check size={12} />}
                                  </div>
                                  <span className="bento-pill-text">
                                    Black &amp; White
                                  </span>
                                </button>

                                <button
                                  type="button"
                                  disabled={!printer.enabled}
                                  className={`bento-mode-pill ${
                                    isColorSelected ? "active" : ""
                                  }`}
                                  onClick={() =>
                                    handleTogglePrintMode(printerKey, "Color")
                                  }
                                >
                                  <div className="bento-pill-check">
                                    {isColorSelected && <Check size={12} />}
                                  </div>
                                  <span className="bento-pill-text">
                                    Color &amp; Photos
                                  </span>
                                </button>
                              </div>
                            </div>

                            {/* Column 2: Paper Trays */}
                            <div className="bento-group">
                              <span className="bento-group-label">
                                Paper Trays
                              </span>
                              <div className="bento-pills-row">
                                {["A4", "Legal", "Letter", "A3"].map(
                                  (size) => {
                                    const isChecked =
                                      printer.capabilities.includes(size);
                                    return (
                                      <button
                                        key={size}
                                        type="button"
                                        disabled={!printer.enabled}
                                        className={`bento-tray-pill ${
                                          isChecked ? "active" : ""
                                        }`}
                                        onClick={() =>
                                          handleTogglePaperTray(printerKey, size)
                                        }
                                      >
                                        <div className="bento-tray-check">
                                          {isChecked && <Check size={11} />}
                                        </div>
                                        <span>{size}</span>
                                      </button>
                                    );
                                  }
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}              </div>
            );
          })()}
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
                        <span>Rush Hour Auto-Print</span>
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
