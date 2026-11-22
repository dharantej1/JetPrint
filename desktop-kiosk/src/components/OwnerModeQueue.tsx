import React, { useEffect, useState } from "react";
import {
  Printer,
  RefreshCw,
  CheckCircle2,
  Clock,
  FileText,
  Calendar,
  ScrollText,
  Ban,
  XCircle,
  Zap,
  ChevronDown,
} from "lucide-react";
import type { ConfiguredPrinter, PrintJob } from "../types";
import { getConfiguredPrinters, openLogsWindow } from "../api/tauri";

export function getTodayLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatJobTime(createdAt: string, includeDate: boolean): string {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return "";
  if (includeDate) {
    return parsed.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface OwnerModeQueueProps {
  jobs: PrintJob[];
  selectedDate: string | null;
  onDateChange: (date: string | null) => void;
  onRefresh: () => void;
  onPrintJob: (jobOrOtp: PrintJob | string, printerOverride?: string) => void;
  onCancelJob: (jobId: string) => void;
  printingOtp: string | null;
  cancellingJobId: string | null;
  rushHourEnabled?: boolean;
  onToggleRushHour?: (enabled: boolean) => void;
  configuredPrinters?: ConfiguredPrinter[];
}

export const OwnerModeQueue: React.FC<OwnerModeQueueProps> = ({
  jobs,
  selectedDate,
  onDateChange,
  onRefresh,
  onPrintJob,
  onCancelJob,
  printingOtp,
  cancellingJobId,
  rushHourEnabled = false,
  onToggleRushHour,
  configuredPrinters: initialPrinters,
}) => {
  const today = getTodayLocalDate();
  const isToday = selectedDate === today;
  const isAll = selectedDate === null;

  const [printers, setPrinters] = useState<ConfiguredPrinter[]>(
    initialPrinters || []
  );
  const [fileOverrides, setFileOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    if (initialPrinters && initialPrinters.length > 0) {
      setPrinters(initialPrinters);
    } else {
      getConfiguredPrinters()
        .then((list) => {
          if (list && list.length > 0) setPrinters(list);
        })
        .catch(() => {});
    }
  }, [initialPrinters]);

  const emptyMessage = isToday
    ? "No print jobs for today yet."
    : selectedDate
      ? `No print jobs for ${selectedDate}.`
      : "No print jobs in queue yet.";

  const defaultPrinterName =
    printers.find((p) => p.isDefault)?.nickname ||
    printers.find((p) => p.isDefault)?.name ||
    (printers.length > 0 ? printers[0].nickname || printers[0].name : "Default");

  return (
    <section className="panel-card" style={{ gap: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Owner Mode — Print Queue</h2>
          <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 2 }}>
            Recent jobs received from Cloud Relay. Print directly or verify OTP.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* Rush Hour Auto-Print Toggle */}
          <button
            type="button"
            className={`rush-hour-toggle-btn ${rushHourEnabled ? "active" : ""}`}
            onClick={() => onToggleRushHour?.(!rushHourEnabled)}
            title={
              rushHourEnabled
                ? "Rush Hour Auto-Print is active: Incoming jobs print automatically"
                : "Enable Rush Hour Auto-Print (auto-prints incoming jobs)"
            }
          >
            <Zap size={14} className={rushHourEnabled ? "rush-icon-pulse" : ""} />
            <span>Rush Hour Auto-Print</span>
            <span className={`rush-indicator ${rushHourEnabled ? "on" : "off"}`}>
              {rushHourEnabled ? "ON" : "OFF"}
            </span>
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => openLogsWindow().catch(() => {})}
            title="Open Application Logs"
          >
            <ScrollText size={15} />
            <span>Logs</span>
          </button>
          <button type="button" className="btn-secondary" onClick={onRefresh}>
            <RefreshCw size={15} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {rushHourEnabled && (
        <div className="rush-hour-active-banner">
          <Zap size={15} className="rush-icon-pulse" />
          <span>
            <strong>⚡ Rush Hour Auto-Print Active:</strong> Incoming print jobs automatically print upon arrival without manual OTP entry.
          </span>
        </div>
      )}

      <div className="queue-filter-bar">
        <div className="queue-filter-group">
          <label className="date-picker-wrap" title="Filter by date">
            <Calendar size={14} className="date-picker-icon" />
            <input
              type="date"
              className="date-filter-input"
              value={selectedDate ?? ""}
              max={today}
              onChange={(e) => onDateChange(e.target.value || null)}
              aria-label="Filter print jobs by date"
            />
          </label>
          <button
            type="button"
            className={`filter-chip ${isToday ? "active" : ""}`}
            onClick={() => onDateChange(today)}
          >
            Today
          </button>
          <button
            type="button"
            className={`filter-chip ${isAll ? "active" : ""}`}
            onClick={() => onDateChange(null)}
          >
            All
          </button>
        </div>
        <span className="queue-count">
          {jobs.length} {jobs.length === 1 ? "job" : "jobs"}
        </span>
      </div>

      <div className="jobs-list" style={{ maxHeight: "100%", flex: 1 }}>
        {jobs.length === 0 ? (
          <div
            style={{
              padding: 32,
              textAlign: "center",
              color: "#64748b",
              border: "1px dashed rgba(148, 163, 184, 0.2)",
              borderRadius: 12,
            }}
          >
            {emptyMessage}
          </div>
        ) : (
          jobs.map((job) => {
            const isPrinted = job.status === "printed";
            const isExpired = job.status === "expired";
            const isCancelled = job.status === "cancelled";
            const isFailed = job.status === "failed";
            const canCancel = job.status === "pending" || job.status === "failed";
            const isDisabledForPrint = isExpired || isCancelled;
            const timeLabel = formatJobTime(job.createdAt, isAll);
            const statusColor = isPrinted
              ? "#6ee7b7"
              : isExpired || isCancelled
                ? "#94a3b8"
                : isFailed
                  ? "#fca5a5"
                  : "#fbbf24";

            return (
              <div key={job.id} className="job-row">
                <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <FileText size={16} color="#818cf8" />
                    <span style={{ fontWeight: 700, fontSize: 14 }}>OTP: {job.otp}</span>
                    <span style={{ color: "#94a3b8", fontSize: 12 }}>
                      • {job.copies} {job.copies === 1 ? "copy" : "copies"} •{" "}
                      {job.color ? "Color" : "B/W"} • {job.files.length} file(s)
                      {timeLabel ? ` • ${timeLabel}` : ""}
                    </span>
                  </div>

                  {/* Per-File List with Assigned Printer Badges and Overrides */}
                  <div className="job-files-container">
                    {job.files.map((file, idx) => {
                      const fileKey = `${job.id}_${file.fileId || idx}`;
                      const override = fileOverrides[fileKey];
                      const assignedPrinter =
                        override ||
                        file.assignedPrinter ||
                        defaultPrinterName ||
                        "Auto (Pool)";

                      return (
                        <div key={file.fileId || idx} className="job-file-row">
                          <div className="job-file-info">
                            <span className="job-file-bullet">•</span>
                            <span className="job-file-name" title={file.filename}>
                              {file.filename || `File ${idx + 1}`}
                            </span>
                            {file.pages ? (
                              <span className="job-file-pages">({file.pages}p)</span>
                            ) : null}
                          </div>

                          <div className="job-file-printer-section">
                            <span
                              className="file-printer-badge"
                              title={`Currently assigned to: ${assignedPrinter}`}
                            >
                              <Printer size={11} />
                              <span className="printer-name-text">{assignedPrinter}</span>
                            </span>

                            <div className="file-printer-select-wrap">
                              <select
                                className="file-printer-select"
                                value={override || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setFileOverrides((prev) => ({
                                    ...prev,
                                    [fileKey]: val,
                                  }));
                                }}
                                disabled={isDisabledForPrint}
                                title="Override assigned printer for this file"
                              >
                                <option value="">Override Printer...</option>
                                {printers.map((p) => (
                                  <option key={p.id || p.name} value={p.name}>
                                    {p.nickname || p.name} ({p.pool.toUpperCase()})
                                  </option>
                                ))}
                              </select>
                              <ChevronDown size={11} className="select-arrow-icon" />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  <span
                    className={`job-status-badge ${isExpired ? "expired" : isCancelled ? "cancelled" : ""}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 12,
                      fontWeight: 600,
                      color: statusColor,
                    }}
                  >
                    {isPrinted ? (
                      <CheckCircle2 size={14} />
                    ) : isCancelled ? (
                      <XCircle size={14} />
                    ) : isExpired ? (
                      <Ban size={14} />
                    ) : (
                      <Clock size={14} />
                    )}
                    {job.status}
                  </span>

                  {canCancel && (
                    <button
                      type="button"
                      className="btn-danger-outline"
                      style={{ padding: "6px 10px", fontSize: 12 }}
                      disabled={cancellingJobId === job.id || printingOtp === job.otp}
                      onClick={() => onCancelJob(job.id)}
                      title="Cancel job and delete stored files"
                    >
                      <XCircle size={13} />
                      <span>{cancellingJobId === job.id ? "Cancelling..." : "Cancel"}</span>
                    </button>
                  )}

                  {/* Direct Print Button */}
                  <button
                    type="button"
                    className="btn-primary direct-print-btn"
                    style={{ padding: "7px 12px", fontSize: 12 }}
                    disabled={isDisabledForPrint || printingOtp === job.otp || cancellingJobId === job.id}
                    title={
                      isCancelled
                        ? "Job was cancelled and its files were deleted"
                        : isExpired
                          ? "Print files expired after 2 days"
                          : "Print job directly bypassing OTP"
                    }
                    onClick={() => {
                      const firstOverrideKey = Object.keys(fileOverrides).find((k) =>
                        k.startsWith(`${job.id}_`)
                      );
                      const printerOverride = firstOverrideKey
                        ? fileOverrides[firstOverrideKey]
                        : undefined;
                      onPrintJob(job, printerOverride);
                    }}
                  >
                    <Zap size={14} />
                    <span>
                      {isCancelled
                        ? "Cancelled"
                        : isExpired
                          ? "Expired"
                          : printingOtp === job.otp
                            ? "Printing..."
                            : "⚡ Direct Print"}
                    </span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
export default OwnerModeQueue;
