import React, { useEffect, useState } from "react";
import {
  ShieldCheck,
  KeyRound,
  Copy,
  Check,
  Loader2,
  Printer,
  Wifi,
  Info,
  FolderOpen,
  ShieldAlert,
  Keyboard as KeyboardIcon,
} from "lucide-react";
import type { KioskState, PrinterInfo } from "../types";
import {
  completeFirstRun,
  connectRelay,
  listPrinters,
  pickStorageFolder,
  resolveStoragePreviewPath,
  setStoragePath,
  updateSettings,
} from "../api/tauri";
import { VirtualKeyboard } from "./VirtualKeyboard";

interface FirstRunWizardProps {
  initialState: KioskState;
  onComplete: (nextState?: KioskState) => void;
}

export const FirstRunWizard: React.FC<FirstRunWizardProps> = ({
  initialState,
  onComplete,
}) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [savedChecked, setSavedChecked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [latestState, setLatestState] = useState<KioskState>(initialState);

  // Step 3: Storage Folder
  const [storageFolder, setStorageFolder] = useState<string>(
    initialState.storagePath || ""
  );

  // Step 4: Printer, Pricing & Cloud Relay
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [defaultPrinter, setDefaultPrinter] = useState<string>(
    initialState.defaultPrinter ?? ""
  );
  const [bwRupees, setBwRupees] = useState<string>(
    (initialState.bwPricePaise / 100).toFixed(2)
  );
  const [colorRupees, setColorRupees] = useState<string>(
    (initialState.colorPricePaise / 100).toFixed(2)
  );
  const [relayUrl, setRelayUrl] = useState<string>(initialState.relayUrl);

  // In-App Virtual Keyboard State for Touch Screens
  const [activeVk, setActiveVk] = useState<{
    label: string;
    field: "password" | "confirmPassword" | "storageFolder" | "bwRupees" | "colorRupees" | "relayUrl";
    type?: "text" | "password" | "number" | "url";
  } | null>(null);

  const getVkValue = (): string => {
    if (!activeVk) return "";
    switch (activeVk.field) {
      case "password":
        return password;
      case "confirmPassword":
        return confirmPassword;
      case "storageFolder":
        return storageFolder;
      case "bwRupees":
        return bwRupees;
      case "colorRupees":
        return colorRupees;
      case "relayUrl":
        return relayUrl;
      default:
        return "";
    }
  };

  const handleVkChange = (val: string) => {
    if (!activeVk) return;
    switch (activeVk.field) {
      case "password":
        setPassword(val);
        break;
      case "confirmPassword":
        setConfirmPassword(val);
        break;
      case "storageFolder":
        setStorageFolder(val);
        break;
      case "bwRupees":
        setBwRupees(val);
        break;
      case "colorRupees":
        setColorRupees(val);
        break;
      case "relayUrl":
        setRelayUrl(val);
        break;
    }
  };

  useEffect(() => {
    if (step !== 4) return;
    let active = true;
    setLoadingPrinters(true);
    listPrinters()
      .then((list) => {
        if (!active) return;
        setPrinters(list);
        if (!defaultPrinter) {
          const systemDefault = list.find((p) => p.isDefault);
          if (systemDefault) {
            setDefaultPrinter(systemDefault.name);
          }
        }
      })
      .catch(() => {
        // Printer discovery is optional during setup
      })
      .finally(() => {
        if (active) setLoadingPrinters(false);
      });
    return () => {
      active = false;
    };
  }, [step]);

  const handleCreatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const result = await completeFirstRun(password);
      setPhrase(result.recoveryPhrase);
      setLatestState(result.state);
      setRelayUrl(result.state.relayUrl);
      if (result.state.storagePath) {
        setStorageFolder(result.state.storagePath);
      }
      setStep(2);
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to initialize kiosk security.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyPhrase = async () => {
    try {
      await navigator.clipboard.writeText(phrase);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be restricted in some webviews; ignore silently
    }
  };

  const handleBrowseStorage = async () => {
    setError("");
    try {
      const picked = await pickStorageFolder();
      if (picked) {
        setStorageFolder(picked);
      }
    } catch (err) {
      setError(typeof err === "string" ? err : "Unable to open folder picker.");
    }
  };

  const handleSaveStorageAndContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const trimmed = storageFolder.trim();
    if (!trimmed) {
      setStep(4);
      return;
    }
    if (resolveStoragePreviewPath(trimmed) === latestState.storagePath) {
      setStep(4);
      return;
    }

    setLoading(true);
    try {
      const nextState = await setStoragePath(trimmed);
      setLatestState(nextState);
      setStorageFolder(nextState.storagePath);
      setStep(4);
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to update storage folder.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfigAndFinish = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const bwPaise = Math.max(0, Math.round(parseFloat(bwRupees || "0") * 100));
    const colorPaise = Math.max(0, Math.round(parseFloat(colorRupees || "0") * 100));

    if (Number.isNaN(bwPaise) || Number.isNaN(colorPaise)) {
      setError("Please enter valid pricing amounts.");
      return;
    }

    const trimmedRelay = relayUrl.trim();
    setLoading(true);
    try {
      let nextState = await updateSettings({
        defaultPrinter: defaultPrinter || undefined,
        bwPricePaise: bwPaise,
        colorPricePaise: colorPaise,
        relayUrl: trimmedRelay || undefined,
      });

      if (trimmedRelay) {
        const connected = await connectRelay(trimmedRelay).catch(() => null);
        if (connected) {
          nextState = connected;
        }
      }
      onComplete(nextState);
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to save kiosk configuration.");
    } finally {
      setLoading(false);
    }
  };

  const words = phrase.trim().split(/\s+/).filter(Boolean);

  const stepTitle =
    step === 1
      ? "Create Owner Password"
      : step === 2
        ? "Save 12-Word Recovery Phrase"
        : step === 3
          ? "Where Should JetPrint Store Files?"
          : "Printer, Pricing & Cloud Relay";

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-header" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="modal-title">
              <ShieldCheck size={22} color="#818cf8" />
              <span>{stepTitle}</span>
            </div>
            <span className="wizard-step-badge">Step {step} of 4</span>
          </div>

          <div className="wizard-progress wizard-progress-4" aria-hidden="true">
            <div className={`wizard-progress-seg ${step >= 1 ? "active" : ""}`} />
            <div className={`wizard-progress-seg ${step >= 2 ? "active" : ""}`} />
            <div className={`wizard-progress-seg ${step >= 3 ? "active" : ""}`} />
            <div className={`wizard-progress-seg ${step >= 4 ? "active" : ""}`} />
          </div>
        </div>

        {step === 1 && (
          <form onSubmit={handleCreatePassword} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.5 }}>
              Create an Owner Password to protect <strong style={{ color: "#f8fafc" }}>Owner Mode</strong> and{" "}
              <strong style={{ color: "#f8fafc" }}>Kiosk Settings</strong> (printer selection, page pricing,
              and Cloud Relay URL) from unauthorized changes by customers.
            </p>

            <div className="form-group">
              <label className="form-label">Admin Password</label>
              <div className="input-with-vk">
                <input
                  type="password"
                  inputMode="text"
                  autoComplete="new-password"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  autoFocus
                  required
                />
                <button
                  type="button"
                  className="input-vk-btn"
                  onClick={() =>
                    setActiveVk(
                      activeVk?.field === "password"
                        ? null
                        : { label: "Admin Password", field: "password", type: "password" }
                    )
                  }
                  title="Toggle on-screen keyboard"
                  aria-label="Toggle on-screen keyboard"
                >
                  <KeyboardIcon size={16} />
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Confirm Admin Password</label>
              <div className="input-with-vk">
                <input
                  type="password"
                  inputMode="text"
                  autoComplete="new-password"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  required
                />
                <button
                  type="button"
                  className="input-vk-btn"
                  onClick={() =>
                    setActiveVk(
                      activeVk?.field === "confirmPassword"
                        ? null
                        : { label: "Confirm Password", field: "confirmPassword", type: "password" }
                    )
                  }
                  title="Toggle on-screen keyboard"
                  aria-label="Toggle on-screen keyboard"
                >
                  <KeyboardIcon size={16} />
                </button>
              </div>
            </div>

            {error && <p className="error-text">{error}</p>}

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 size={16} className="spin" />
                  <span>Generating Recovery Phrase...</span>
                </>
              ) : (
                <>
                  <KeyRound size={16} />
                  <span>Continue &amp; Generate Recovery Phrase</span>
                </>
              )}
            </button>
          </form>
        )}

        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.5 }}>
              Write down these 12 words in order and store them safely. This recovery phrase is the{" "}
              <strong style={{ color: "#f8fafc" }}>only way</strong> to reset your Owner Password if forgotten.
            </p>

            <div className="phrase-grid">
              {words.map((word, idx) => (
                <div key={idx} className="phrase-word">
                  <span className="phrase-idx">{idx + 1}.</span>
                  <span>{word}</span>
                </div>
              ))}
            </div>

            <button type="button" className="btn-secondary" onClick={handleCopyPhrase}>
              {copied ? <Check size={15} color="#10b981" /> : <Copy size={15} />}
              <span>{copied ? "Copied to Clipboard" : "Copy 12-Word Phrase"}</span>
            </button>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={savedChecked}
                onChange={(e) => setSavedChecked(e.target.checked)}
              />
              <span>I have saved my recovery phrase in a safe place</span>
            </label>

            <button
              type="button"
              className="btn-primary"
              disabled={!savedChecked}
              onClick={() => {
                setError("");
                setStep(3);
              }}
            >
              Continue to Storage Location
            </button>
          </div>
        )}

        {step === 3 && (
          <form onSubmit={handleSaveStorageAndContinue} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.55 }}>
              JetPrint stores its local database (<code style={{ color: "#cbd5e1" }}>jetprint.db</code>),
              downloaded customer print files (<code style={{ color: "#cbd5e1" }}>jobs/</code>), and
              application logs (<code style={{ color: "#cbd5e1" }}>logs/</code>) inside a{" "}
              <strong style={{ color: "#f8fafc" }}>JetPrint KIOSK</strong> subfolder in your chosen folder.
            </p>

            <div className="form-group">
              <label className="form-label">Target Storage Folder</label>
              <div style={{ display: "flex", gap: 8 }}>
                <div className="input-with-vk" style={{ flex: 1 }}>
                  <input
                    type="text"
                    inputMode="text"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={storageFolder}
                    onChange={(e) => setStorageFolder(e.target.value)}
                    placeholder="Default application data folder"
                    required
                  />
                  <button
                    type="button"
                    className="input-vk-btn"
                    onClick={() =>
                      setActiveVk(
                        activeVk?.field === "storageFolder"
                          ? null
                          : { label: "Storage Folder", field: "storageFolder", type: "text" }
                      )
                    }
                    title="Toggle on-screen keyboard"
                    aria-label="Toggle on-screen keyboard"
                  >
                    <KeyboardIcon size={16} />
                  </button>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleBrowseStorage}
                  disabled={loading}
                >
                  <FolderOpen size={15} />
                  <span>Browse Folder...</span>
                </button>
              </div>
              {storageFolder.trim() && (
                <span style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.4, wordBreak: "break-all" }}>
                  Resolved folder:{" "}
                  <code style={{ color: "#c7d2fe" }}>
                    {resolveStoragePreviewPath(storageFolder)}
                  </code>
                </span>
              )}
            </div>

            <div className="wizard-tip-box">
              <ShieldAlert size={16} color="#818cf8" style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                <strong>Customer Privacy:</strong> Printed files are{" "}
                <strong>deleted immediately</strong> after printing succeeds. Unprinted paid files
                are <strong>automatically deleted after 2 days</strong>.
              </span>
            </div>

            {error && <p className="error-text">{error}</p>}

            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ flex: 1 }}
                disabled={loading}
                onClick={() => {
                  setError("");
                  setStep(4);
                }}
              >
                Use Default Folder
              </button>
              <button
                type="submit"
                className="btn-primary"
                style={{ flex: 1.5 }}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    <span>Applying Folder...</span>
                  </>
                ) : (
                  <span>Continue to Printer &amp; Relay</span>
                )}
              </button>
            </div>
          </form>
        )}

        {step === 4 && (
          <form onSubmit={handleSaveConfigAndFinish} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="form-group">
              <label className="form-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Printer size={14} color="#818cf8" />
                <span>Default Printer</span>
              </label>
              <select
                value={defaultPrinter}
                onChange={(e) => setDefaultPrinter(e.target.value)}
                disabled={loadingPrinters}
              >
                <option value="">
                  {loadingPrinters ? "Scanning system printers..." : "System Default / None selected"}
                </option>
                {printers.map((p) => (
                  <option key={p.systemName} value={p.name}>
                    {p.name}
                    {p.isDefault ? " (System Default)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">B&amp;W Price (₹ / page)</label>
                <div className="input-with-vk">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    min="0"
                    value={bwRupees}
                    onChange={(e) => setBwRupees(e.target.value)}
                  />
                  <button
                    type="button"
                    className="input-vk-btn"
                    onClick={() =>
                      setActiveVk(
                        activeVk?.field === "bwRupees"
                          ? null
                          : { label: "B/W Price", field: "bwRupees", type: "number" }
                      )
                    }
                    title="Toggle on-screen keyboard"
                    aria-label="Toggle on-screen keyboard"
                  >
                    <KeyboardIcon size={16} />
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Color Price (₹ / page)</label>
                <div className="input-with-vk">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    min="0"
                    value={colorRupees}
                    onChange={(e) => setColorRupees(e.target.value)}
                  />
                  <button
                    type="button"
                    className="input-vk-btn"
                    onClick={() =>
                      setActiveVk(
                        activeVk?.field === "colorRupees"
                          ? null
                          : { label: "Color Price", field: "colorRupees", type: "number" }
                      )
                    }
                    title="Toggle on-screen keyboard"
                    aria-label="Toggle on-screen keyboard"
                  >
                    <KeyboardIcon size={16} />
                  </button>
                </div>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Wifi size={14} color="#818cf8" />
                <span>Cloud Relay URL</span>
              </label>
              <div className="input-with-vk">
                <input
                  type="url"
                  inputMode="url"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={relayUrl}
                  onChange={(e) => setRelayUrl(e.target.value)}
                  placeholder="http://localhost:3000"
                />
                <button
                  type="button"
                  className="input-vk-btn"
                  onClick={() =>
                    setActiveVk(
                      activeVk?.field === "relayUrl"
                        ? null
                        : { label: "Cloud Relay URL", field: "relayUrl", type: "url" }
                    )
                  }
                  title="Toggle on-screen keyboard"
                  aria-label="Toggle on-screen keyboard"
                >
                  <KeyboardIcon size={16} />
                </button>
              </div>
              <span style={{ fontSize: 12, color: "#64748b", lineHeight: 1.4 }}>
                The Cloud Relay server connects this kiosk to the customer QR upload page and
                delivers print jobs &amp; OTPs.
              </span>
            </div>

            <div className="wizard-tip-box">
              <Info size={16} color="#818cf8" style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                You can change these settings anytime via the <strong>Gear icon</strong> (top-right),{" "}
                <strong>Ctrl/Cmd + Shift + S</strong>, or by <strong>tapping the top-left corner 5 times</strong>.
              </span>
            </div>

            {error && <p className="error-text">{error}</p>}

            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ flex: 1 }}
                disabled={loading}
                onClick={() => onComplete(latestState)}
              >
                Skip for Now
              </button>
              <button
                type="submit"
                className="btn-primary"
                style={{ flex: 1.5 }}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    <span>Saving &amp; Connecting...</span>
                  </>
                ) : (
                  <span>Save &amp; Launch Kiosk</span>
                )}
              </button>
            </div>
          </form>
        )}
      </div>

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
