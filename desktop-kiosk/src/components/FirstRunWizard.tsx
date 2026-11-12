import React, { useState } from "react";
import { ShieldCheck, KeyRound, Copy, Check, Loader2 } from "lucide-react";
import { completeFirstRun } from "../api/tauri";

interface FirstRunWizardProps {
  onComplete: () => void;
}

export const FirstRunWizard: React.FC<FirstRunWizardProps> = ({ onComplete }) => {
  const [step, setStep] = useState<"password" | "phrase">("password");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [savedChecked, setSavedChecked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
      setStep("phrase");
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

  const words = phrase.trim().split(/\s+/).filter(Boolean);

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-header">
          <div className="modal-title">
            <ShieldCheck size={22} color="#818cf8" />
            <span>
              {step === "password"
                ? "JetPrint Kiosk Setup"
                : "Save Your Recovery Phrase"}
            </span>
          </div>
        </div>

        {step === "password" ? (
          <form onSubmit={handleCreatePassword} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.5 }}>
              Create an Owner Password to protect kiosk settings, pricing, and printer configuration.
            </p>

            <div className="form-group">
              <label className="form-label">Admin Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                autoFocus
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Confirm Admin Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                required
              />
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
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.5 }}>
              Write down these 12 words in order and store them safely. This is the{" "}
              <strong style={{ color: "#f8fafc" }}>only way</strong> to reset your owner password if forgotten.
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
              <span>I have saved my recovery phrase</span>
            </label>

            <button
              type="button"
              className="btn-primary"
              disabled={!savedChecked}
              onClick={onComplete}
            >
              Finish Setup &amp; Launch Kiosk
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
