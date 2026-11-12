import React, { useState } from "react";
import { AlertTriangle, Database, Loader2, RotateCcw, CheckCircle2 } from "lucide-react";
import type { KioskState } from "../types";
import { keepExistingData, resetInstallationData } from "../api/tauri";

interface ExistingDataModalProps {
  machineId: string;
  existingJobCount: number;
  onResolved: (nextState: KioskState) => void;
}

export const ExistingDataModal: React.FC<ExistingDataModalProps> = ({
  machineId,
  existingJobCount,
  onResolved,
}) => {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [loadingAction, setLoadingAction] = useState<"keep" | "reset" | null>(null);
  const [error, setError] = useState("");

  const handleKeep = async () => {
    setError("");
    setLoadingAction("keep");
    try {
      const next = await keepExistingData();
      onResolved(next);
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to keep existing data.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleReset = async () => {
    setError("");
    setLoadingAction("reset");
    try {
      const next = await resetInstallationData();
      onResolved(next);
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to reset installation data.");
    } finally {
      setLoadingAction(null);
    }
  };

  const isBusy = loadingAction !== null;

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-header">
          <div className="modal-title">
            <Database size={22} color="#818cf8" />
            <span>Existing JetPrint Data Detected</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.55 }}>
            A new installation of JetPrint was detected on this machine, but previous kiosk data
            is already stored locally. Choose whether to continue with your existing setup or
            wipe it and start fresh.
          </p>

          <div className="existing-data-summary">
            <div className="existing-data-row">
              <span className="existing-data-label">Previous Machine ID</span>
              <span className="existing-data-value">{machineId}</span>
            </div>
            <div className="existing-data-row">
              <span className="existing-data-label">Saved Print Jobs</span>
              <span className="existing-data-value">
                {existingJobCount} {existingJobCount === 1 ? "job" : "jobs"}
              </span>
            </div>
          </div>

          {confirmingReset && (
            <div className="danger-callout">
              <AlertTriangle size={18} color="#fca5a5" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 13, color: "#fecaca", lineHeight: 1.5 }}>
                <strong>Are you sure?</strong> Starting fresh will permanently delete{" "}
                {existingJobCount} saved print {existingJobCount === 1 ? "job" : "jobs"}, clear
                your owner password, pricing, printer, and Cloud Relay settings, and generate a
                new Machine ID.
              </div>
            </div>
          )}

          {error && <p className="error-text">{error}</p>}

          {!confirmingReset ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                type="button"
                className="btn-primary"
                disabled={isBusy}
                onClick={handleKeep}
              >
                {loadingAction === "keep" ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    <span>Restoring Previous Setup...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} />
                    <span>Keep Previous Data</span>
                  </>
                )}
              </button>

              <button
                type="button"
                className="btn-danger-outline"
                disabled={isBusy}
                onClick={() => setConfirmingReset(true)}
              >
                <RotateCcw size={15} />
                <span>Start Fresh (Remove Previous Data)</span>
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ flex: 1 }}
                disabled={isBusy}
                onClick={() => setConfirmingReset(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                style={{ flex: 1.5 }}
                disabled={isBusy}
                onClick={handleReset}
              >
                {loadingAction === "reset" ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    <span>Removing Data...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw size={15} />
                    <span>Yes, Remove Data &amp; Start Fresh</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
