import React, { useEffect } from "react";
import {
  CheckCircle2,
  Delete,
  AlertCircle,
  Loader2,
  Printer,
  KeyRound,
  FileText,
} from "lucide-react";
import type { PrintJob } from "../types";

export type OtpFeedbackStatus = "idle" | "verifying" | "success" | "error";

interface OtpKeypadProps {
  otp: string;
  onChangeOtp: (next: string) => void;
  onSubmit: () => void;
  status: OtpFeedbackStatus;
  feedbackMessage: string;
  printedJob?: PrintJob | null;
  disabled?: boolean;
}

export const OtpKeypad: React.FC<OtpKeypadProps> = ({
  otp,
  onChangeOtp,
  onSubmit,
  status,
  feedbackMessage,
  printedJob = null,
  disabled = false,
}) => {
  const isBusy = status === "verifying";

  const handleDigit = (digit: string) => {
    if (isBusy || disabled || otp.length >= 6) return;
    onChangeOtp(otp + digit);
  };

  const handleBackspace = () => {
    if (isBusy || disabled || otp.length === 0) return;
    onChangeOtp(otp.slice(0, -1));
  };

  const handleClear = () => {
    if (isBusy || disabled) return;
    onChangeOtp("");
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (disabled || isBusy) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        if (otp.length < 6) onChangeOtp(otp + e.key);
      } else if (e.key === "Backspace") {
        if (otp.length > 0) onChangeOtp(otp.slice(0, -1));
      } else if (e.key === "Escape") {
        onChangeOtp("");
      } else if (e.key === "Enter" && otp.length === 6) {
        onSubmit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [otp, disabled, isBusy, onChangeOtp, onSubmit]);

  const bannerClass =
    status === "verifying"
      ? "status-banner info"
      : status === "success"
      ? "status-banner success"
      : status === "error"
      ? "status-banner error"
      : "status-banner idle";

  return (
    <section className="panel-card keypad-section">
      <div className="otp-header">
        <h2 className="otp-title">Enter Print OTP</h2>
        <p className="otp-subtitle">Type the 6-digit code shown after payment</p>
      </div>

      <div className="otp-boxes" aria-label="6-digit OTP display">
        {Array.from({ length: 6 }).map((_, idx) => {
          const char = otp[idx] || "";
          const isActive = idx === otp.length && !isBusy;
          return (
            <div
              key={idx}
              className={`otp-box ${char ? "filled" : ""} ${isActive ? "active" : ""}`}
            >
              {char}
            </div>
          );
        })}
      </div>

      <div className={bannerClass} role="status" aria-live="polite">
        {status === "verifying" && <Loader2 size={16} className="spin" />}
        {status === "success" && <CheckCircle2 size={16} />}
        {status === "error" && <AlertCircle size={16} />}
        {status === "idle" && <KeyRound size={15} />}
        <span>
          {feedbackMessage || "Enter your 6-digit OTP and tap Print"}
        </span>
      </div>

      {status === "success" && printedJob && printedJob.files.length > 0 && (
        <div className="otp-printed-docs" aria-label="Printed documents">
          {printedJob.files.map((file, idx) => (
            <div key={file.fileId || idx} className="otp-printed-doc-item">
              <span className="otp-printed-doc-name">
                <FileText size={13} color="#6ee7b7" />
                <span>{file.filename || "Document"}</span>
              </span>
              <span className="otp-printed-doc-meta">
                {printedJob.copies} {printedJob.copies === 1 ? "copy" : "copies"} •{" "}
                {printedJob.color ? "Color" : "B/W"}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="keypad-grid">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <button
            key={digit}
            type="button"
            className="key-btn"
            onClick={() => handleDigit(digit)}
            disabled={isBusy || disabled}
          >
            {digit}
          </button>
        ))}

        <button
          type="button"
          className="key-btn action-clear"
          onClick={handleClear}
          disabled={isBusy || disabled}
        >
          Clear
        </button>

        <button
          type="button"
          className="key-btn"
          onClick={() => handleDigit("0")}
          disabled={isBusy || disabled}
        >
          0
        </button>

        <button
          type="button"
          className="key-btn action-backspace"
          onClick={handleBackspace}
          disabled={isBusy || disabled}
          aria-label="Backspace"
        >
          <Delete size={22} />
        </button>
      </div>

      <button
        type="button"
        className="print-btn"
        onClick={onSubmit}
        disabled={otp.length !== 6 || isBusy || disabled}
      >
        {isBusy ? (
          <>
            <Loader2 size={20} className="spin" />
            <span>Verifying &amp; Printing...</span>
          </>
        ) : (
          <>
            <Printer size={20} />
            <span>Print Document</span>
          </>
        )}
      </button>
    </section>
  );
};
