import React from "react";
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
} from "lucide-react";
import type { PrintJob } from "../types";
import { openLogsWindow } from "../api/tauri";

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

interface OwnerModeQueueProps {
  jobs: PrintJob[];
  selectedDate: string | null;
  onDateChange: (date: string | null) => void;
  onRefresh: () => void;
  onPrintJob: (otp: string) => void;
  onCancelJob: (jobId: string) => void;
  printingOtp: string | null;
  cancellingJobId: string | null;
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
}) => {
  const today = getTodayLocalDate();
  const isToday = selectedDate === today;
  const isAll = selectedDate === null;

  const emptyMessage = isToday
    ? "No print jobs for today yet."
    : selectedDate
      ? `No print jobs for ${selectedDate}.`
      : "No print jobs in queue yet.";

  return (
    <section className="panel-card" style={{ gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Owner Mode — Print Queue</h2>
          <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 2 }}>
            Recent jobs received from Cloud Relay. Print directly or verify OTP.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <FileText size={15} color="#818cf8" />
                    <span style={{ fontWeight: 600 }}>OTP: {job.otp}</span>
                    <span style={{ color: "#94a3b8", fontSize: 12 }}>
                      • {job.copies} {job.copies === 1 ? "copy" : "copies"} •{" "}
                      {job.color ? "Color" : "B/W"} • {job.files.length} file(s)
                      {timeLabel ? ` • ${timeLabel}` : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    {job.files.map((f) => f.filename || "Document").join(", ")}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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

                  <button
                    type="button"
                    className="btn-primary"
                    style={{ padding: "7px 12px", fontSize: 12 }}
                    disabled={isDisabledForPrint || printingOtp === job.otp || cancellingJobId === job.id}
                    title={
                      isCancelled
                        ? "Job was cancelled and its files were deleted"
                        : isExpired
                          ? "Print files expired after 2 days"
                          : undefined
                    }
                    onClick={() => onPrintJob(job.otp)}
                  >
                    <Printer size={14} />
                    <span>
                      {isCancelled
                        ? "Cancelled"
                        : isExpired
                          ? "Expired"
                          : printingOtp === job.otp
                            ? "Printing..."
                            : "Print"}
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
