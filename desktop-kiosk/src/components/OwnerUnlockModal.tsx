import React, { useState } from "react";
import { X, Lock, KeyRound, Loader2, Keyboard as KeyboardIcon } from "lucide-react";
import { verifyOwnerPassword, resetPasswordWithPhrase } from "../api/tauri";
import { VirtualKeyboard } from "./VirtualKeyboard";

interface OwnerUnlockModalProps {
  onUnlock: () => void;
  onClose: () => void;
}

export const OwnerUnlockModal: React.FC<OwnerUnlockModalProps> = ({
  onUnlock,
  onClose,
}) => {
  const [view, setView] = useState<"login" | "reset">("login");
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSuccess, setAuthSuccess] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // In-App Virtual Keyboard State for Touch Screens
  const [activeVk, setActiveVk] = useState<{
    label: string;
    field: "password" | "phrase" | "newPassword";
    type?: "text" | "password";
  } | null>(null);

  const getVkValue = (): string => {
    if (!activeVk) return "";
    switch (activeVk.field) {
      case "password":
        return password;
      case "phrase":
        return phrase;
      case "newPassword":
        return newPassword;
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
      case "phrase":
        setPhrase(val);
        break;
      case "newPassword":
        setNewPassword(val);
        break;
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      const ok = await verifyOwnerPassword(password);
      if (ok) {
        onUnlock();
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
    setAuthLoading(true);
    try {
      await resetPasswordWithPhrase(phrase, newPassword);
      setAuthSuccess("Password reset successfully. Please unlock.");
      setView("login");
      setPassword(newPassword);
      setPhrase("");
      setNewPassword("");
    } catch (err) {
      setAuthError(typeof err === "string" ? err : "Reset failed.");
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card"
        style={{
          width: "100%",
          maxWidth: 440,
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-lg)",
          padding: 24,
          boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          position: "relative",
          zIndex: 100,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "rgba(99, 102, 241, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent-primary)",
              }}
            >
              <Lock size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>
                {view === "login" ? "Unlock Owner Settings" : "Reset Owner Password"}
              </h3>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                {view === "login"
                  ? "Enter owner password to access dedicated settings space"
                  : "Enter your 12-word recovery phrase"}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="settings-trigger-btn"
            style={{ width: 32, height: 32 }}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {view === "login" ? (
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}>
                Owner Password
              </label>
              <div className="input-with-vk" data-vk-field="password">
                <input
                  type="password"
                  inputMode="text"
                  autoComplete="current-password"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter admin password"
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
                        : { label: "Owner Password", field: "password", type: "password" }
                    )
                  }
                  title="Toggle on-screen keyboard"
                  aria-label="Toggle on-screen keyboard"
                >
                  <KeyboardIcon size={16} />
                </button>
              </div>
            </div>

            {authError && <p className="error-text" style={{ color: "var(--danger)", fontSize: 13 }}>{authError}</p>}
            {authSuccess && <p className="success-text" style={{ color: "var(--success)", fontSize: 13 }}>{authSuccess}</p>}

            <button type="submit" className="btn-primary" disabled={authLoading} style={{ width: "100%", justifyContent: "center" }}>
              {authLoading ? <Loader2 size={16} className="spin" /> : <Lock size={16} />}
              <span>Unlock Dedicated Settings</span>
            </button>

            <button
              type="button"
              className="btn-link"
              style={{ fontSize: 12, color: "var(--accent-primary)", textAlign: "center", marginTop: 4, cursor: "pointer", background: "none", border: "none" }}
              onClick={() => {
                setAuthError("");
                setAuthSuccess("");
                setView("reset");
              }}
            >
              Forgot Password? Reset with 12-word Phrase
            </button>
          </form>
        ) : (
          <form onSubmit={handleResetPassword} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}>
                12-Word BIP39 Recovery Phrase
              </label>
              <div className="input-with-vk" data-vk-field="phrase" style={{ alignItems: "flex-start" }}>
                <textarea
                  rows={3}
                  inputMode="text"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  placeholder="word1 word2 word3 ... word12"
                  required
                />
                <button
                  type="button"
                  className="input-vk-btn"
                  onClick={() =>
                    setActiveVk(
                      activeVk?.field === "phrase"
                        ? null
                        : { label: "12-Word Phrase", field: "phrase", type: "text" }
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
              <label className="form-label" style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}>
                New Owner Password
              </label>
              <div className="input-with-vk" data-vk-field="newPassword">
                <input
                  type="password"
                  inputMode="text"
                  autoComplete="new-password"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  required
                />
                <button
                  type="button"
                  className="input-vk-btn"
                  onClick={() =>
                    setActiveVk(
                      activeVk?.field === "newPassword"
                        ? null
                        : { label: "New Password", field: "newPassword", type: "password" }
                    )
                  }
                  title="Toggle on-screen keyboard"
                  aria-label="Toggle on-screen keyboard"
                >
                  <KeyboardIcon size={16} />
                </button>
              </div>
            </div>

            {authError && <p className="error-text" style={{ color: "var(--danger)", fontSize: 13 }}>{authError}</p>}

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
              <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: "center" }} disabled={authLoading}>
                {authLoading ? <Loader2 size={16} className="spin" /> : <KeyRound size={16} />}
                <span>Reset Password</span>
              </button>
            </div>
          </form>
        )}
      </div>

      {activeVk && (
        <VirtualKeyboard
          label={activeVk.label}
          value={getVkValue()}
          type={activeVk.type || "text"}
          onChange={handleVkChange}
          onClose={() => setActiveVk(null)}
          onSubmit={() => setActiveVk(null)}
        />
      )}
    </div>
  );
};
