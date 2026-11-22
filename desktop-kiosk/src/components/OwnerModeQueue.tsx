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
  AlertCircle,
  RotateCcw,
  Loader2,
  Search,
  Archive,
  X,
} from "lucide-react";
import type { ConfiguredPrinter, PrintJob } from "../types";
import { getConfiguredPrinters, openLogsWindow } from "../api/tauri";
import { getTodayLocalDate } from "../utils";

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
  onPrintJob: (
    jobOrOtp: PrintJob | string,
    printerOverride?: string,
    printerOverrides?: Record<string, string>
  ) => void;
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
  const [queueTab, setQueueTab] = useState<"action" | "completed" | "printed" | "all">("action");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showRushBanner, setShowRushBanner] = useState<boolean>(false);

  useEffect(() => {
    if (rushHourEnabled) {
      setShowRushBanner(true);
      const timer = setTimeout(() => {
        setShowRushBanner(false);
      }, 10000);
      return () => clearTimeout(timer);
    } else {
      setShowRushBanner(false);
    }
  }, [rushHourEnabled]);

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

  const defaultPrinterName =
    printers.find((p) => p.isDefault)?.nickname ||
    printers.find((p) => p.isDefault)?.name ||
    (printers.length > 0 ? printers[0].nickname || printers[0].name : "Auto (Pool)");

  // Compute status summary lists
  const printedJobs = jobs.filter((j) => j.status === "printed");
  const actionJobs = jobs.filter(
    (j) => j.status === "pending" || j.status === "printing" || j.status === "failed"
  );
  const completedJobs = jobs.filter(
    (j) => j.status === "printed" || j.status === "cancelled" || j.status === "expired"
  );

  // Tab Filtering
  let tabFilteredJobs = jobs;
  if (queueTab === "action") {
    tabFilteredJobs = actionJobs;
  } else if (queueTab === "completed") {
    tabFilteredJobs = completedJobs;
  } else if (queueTab === "printed") {
    tabFilteredJobs = printedJobs;
  }

  // Quick OTP / File Search Filtering
  const trimmedSearch = searchQuery.trim().toLowerCase();
  const displayJobs = trimmedSearch
    ? tabFilteredJobs.filter(
        (j) =>
          j.otp.toLowerCase().includes(trimmedSearch) ||
          j.files.some((f) => f.filename?.toLowerCase().includes(trimmedSearch))
      )
    : tabFilteredJobs;

  const emptyMessage = isToday
    ? "No print jobs for today yet."
    : selectedDate
      ? `No print jobs for ${selectedDate}.`
      : "No print jobs in queue yet.";

  return (
    <section className="panel-card owner-queue-panel">
      {/* Top Header Section */}
      <div className="owner-queue-header">
        <div className="owner-queue-title-wrap">
          <div className="owner-title-row">
            <h2 className="owner-queue-heading">Owner Mode — Print Queue</h2>
          </div>
          <p className="owner-queue-subtext">
            Incoming customer print jobs. Print directly, re-route, or verify OTP.
          </p>
        </div>

        <div className="owner-queue-actions">
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
            className="owner-action-btn"
            onClick={() => openLogsWindow().catch(() => {})}
            title="Open Application Logs"
          >
            <ScrollText size={15} />
            <span>Logs</span>
          </button>
          <button
            type="button"
            className="owner-action-btn"
            onClick={onRefresh}
            title="Refresh jobs from database"
          >
            <RefreshCw size={15} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Rush Hour Active Banner (Auto-vanishes after 10s or dismiss) */}
      {showRushBanner && (
        <div className="rush-hour-active-banner">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Zap size={16} className="rush-icon-pulse" />
            <span>
              <strong>Rush Hour Auto-Print Active:</strong> New print jobs
              automatically print upon arrival without manual OTP entry.
            </span>
          </div>
          <button
            type="button"
            className="rush-banner-dismiss-btn"
            onClick={() => setShowRushBanner(false)}
            title="Dismiss notice"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Rush Hour Queue Navigation & Quick Search Bar */}
      <div className="rush-queue-nav-bar">
        {/* Action / Completed / All Tabs */}
        <div className="rush-tabs-group">
          <button
            type="button"
            className={`rush-tab-btn ${queueTab === "action" ? "active" : ""}`}
            onClick={() => setQueueTab("action")}
          >
            <Zap size={14} className={actionJobs.length > 0 ? "rush-icon-pulse" : ""} />
            <span className="rush-tab-label">Action Needed</span>
            <span className={`rush-tab-badge ${actionJobs.length > 0 ? "badge-urgent" : ""}`}>
              {actionJobs.length}
            </span>
          </button>

          <button
            type="button"
            className={`rush-tab-btn ${queueTab === "completed" ? "active" : ""}`}
            onClick={() => setQueueTab("completed")}
          >
            <CheckCircle2 size={14} />
            <span className="rush-tab-label">Completed</span>
            <span className="rush-tab-badge">{completedJobs.length}</span>
          </button>

          <button
            type="button"
            className={`rush-tab-btn ${queueTab === "printed" ? "active" : ""}`}
            onClick={() => setQueueTab("printed")}
            title="Filter by printed documents"
          >
            <span className="dot dot-emerald" />
            <span className="rush-tab-label">Printed</span>
            <span className="rush-tab-badge">{printedJobs.length}</span>
          </button>

          <button
            type="button"
            className={`rush-tab-btn ${queueTab === "all" ? "active" : ""}`}
            onClick={() => setQueueTab("all")}
          >
            <span className="rush-tab-label">All Jobs</span>
            <span className="rush-tab-badge">{jobs.length}</span>
          </button>
        </div>

        {/* Quick OTP / File Search Input */}
        <div className="rush-search-box">
          <Search size={14} className="rush-search-icon" />
          <input
            type="text"
            className="rush-search-input"
            placeholder="Quick search OTP or file..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="rush-search-clear-btn"
              onClick={() => setSearchQuery("")}
              title="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Filter and Date Bar */}
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
          Showing {displayJobs.length} {displayJobs.length === 1 ? "job" : "jobs"}
          {queueTab === "action"
            ? " needing print action"
            : queueTab === "printed"
              ? " printed"
              : queueTab === "completed"
                ? " in archive"
                : ""}
        </span>
      </div>

      {/* Jobs Cards List */}
      <div className="jobs-list touch-friendly-scroll">
        {displayJobs.length === 0 ? (
          <div className="queue-empty-state">
            {trimmedSearch ? (
              <>
                <Search size={32} style={{ opacity: 0.35, marginBottom: 8 }} />
                <h4 style={{ margin: "0 0 6px 0", fontSize: 16, color: "var(--text-primary)" }}>
                  No matching jobs found
                </h4>
                <p style={{ margin: "0 0 12px 0", fontSize: 13, color: "var(--text-secondary)" }}>
                  No jobs matched OTP or filename &quot;{searchQuery}&quot;.
                </p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setSearchQuery("")}
                >
                  Clear Search
                </button>
              </>
            ) : queueTab === "action" ? (
              <>
                <CheckCircle2 size={36} color="#10b981" style={{ marginBottom: 8 }} />
                <h4 style={{ margin: "0 0 6px 0", fontSize: 16, color: "var(--text-primary)" }}>
                  All Caught Up!
                </h4>
                <p style={{ margin: "0 0 12px 0", fontSize: 13, color: "var(--text-secondary)" }}>
                  There are no pending documents waiting for print action.
                </p>
                {completedJobs.length > 0 && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setQueueTab("completed")}
                  >
                    <Archive size={14} />
                    <span>View Completed Archive ({completedJobs.length})</span>
                  </button>
                )}
              </>
            ) : queueTab === "printed" ? (
              <>
                <Printer size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
                <h4 style={{ margin: "0 0 6px 0", fontSize: 16, color: "var(--text-primary)" }}>
                  No Printed Documents
                </h4>
                <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
                  No jobs have completed printing for this date range.
                </p>
              </>
            ) : (
              <>
                <Printer size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
                <p>{emptyMessage}</p>
              </>
            )}
          </div>
        ) : (
          displayJobs.map((job) => {
            const isThisPrinting = printingOtp === job.otp || job.status === "printing";
            const isPrinted = job.status === "printed";
            const isExpired = job.status === "expired";
            const isCancelled = job.status === "cancelled";
            const isFailed = job.status === "failed";
            const canCancel =
              (job.status === "pending" || job.status === "failed") &&
              !isThisPrinting;
            const showPrintButton = !isPrinted && !isExpired && !isCancelled;
            const isDisabledForPrint = isExpired || isCancelled || isThisPrinting;
            const timeLabel = formatJobTime(job.createdAt, isAll);

            return (
              <div
                key={job.id}
                className={`owner-job-card ${isThisPrinting ? "status-printing" : ""} ${isFailed ? "status-failed" : ""} ${isPrinted ? "status-printed" : ""}`}
              >
                {/* Job Card Header */}
                <div className="owner-job-card-header">
                  <div className="job-header-left">
                    <span className="job-otp-badge" title="Customer 6-Digit OTP">
                      OTP: {job.otp}
                    </span>
                    <div className="job-spec-chips">
                      <span className="spec-chip">
                        {job.copies} {job.copies === 1 ? "copy" : "copies"}
                      </span>
                      <span
                        className={`spec-chip ${job.color ? "color-chip" : "bw-chip"}`}
                      >
                        {job.color ? "🎨 Color" : "📄 B/W"}
                      </span>
                      <span className="spec-chip">
                        {job.files.length} {job.files.length === 1 ? "file" : "files"}
                      </span>
                      {timeLabel && (
                        <span className="spec-chip time-chip">
                          <Clock size={11} /> {timeLabel}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="job-header-right">
                    {/* Status Badge */}
                    <div className="job-status-indicator">
                      {isThisPrinting ? (
                        <span className="job-status-pill status-printing">
                          <Loader2 size={13} className="spin" />
                          <span>Printing...</span>
                        </span>
                      ) : isPrinted ? (
                        <span className="job-status-pill status-printed">
                          <CheckCircle2 size={13} />
                          <span>Printed</span>
                        </span>
                      ) : isFailed ? (
                        <span className="job-status-pill status-failed">
                          <AlertCircle size={13} />
                          <span>Failed</span>
                        </span>
                      ) : isCancelled ? (
                        <span className="job-status-pill status-cancelled">
                          <XCircle size={13} />
                          <span>Cancelled</span>
                        </span>
                      ) : isExpired ? (
                        <span className="job-status-pill status-expired">
                          <Ban size={13} />
                          <span>Expired</span>
                        </span>
                      ) : (
                        <span className="job-status-pill status-pending">
                          <Clock size={13} />
                          <span>Pending</span>
                        </span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="job-action-buttons">
                      {canCancel && (
                        <button
                          type="button"
                          className="btn-danger-outline btn-compact"
                          disabled={cancellingJobId === job.id}
                          onClick={() => onCancelJob(job.id)}
                          title="Cancel this job"
                        >
                          <XCircle size={13} />
                          <span>
                            {cancellingJobId === job.id ? "Cancelling..." : "Cancel"}
                          </span>
                        </button>
                      )}

                      {showPrintButton && (
                        <button
                          type="button"
                          className={`btn-primary direct-print-btn ${isFailed ? "btn-retry" : ""}`}
                          disabled={isThisPrinting || cancellingJobId === job.id}
                          title={
                            isThisPrinting
                              ? "Job is currently being sent to printer"
                              : isFailed
                                ? "Retry sending job to printer"
                                : "Print job directly bypassing customer OTP"
                          }
                          onClick={() => {
                            const jobOverrides: Record<string, string> = {};
                            for (const f of job.files) {
                              const k = `${job.id}_${f.fileId}`;
                              if (fileOverrides[k]) {
                                jobOverrides[f.fileId] = fileOverrides[k];
                              }
                            }
                            const firstOverrideKey = Object.keys(fileOverrides).find(
                              (k) => k.startsWith(`${job.id}_`)
                            );
                            const printerOverride = firstOverrideKey
                              ? fileOverrides[firstOverrideKey]
                              : undefined;
                            onPrintJob(
                              job,
                              printerOverride,
                              Object.keys(jobOverrides).length > 0 ? jobOverrides : undefined
                            );
                          }}
                        >
                          {isThisPrinting ? (
                            <>
                              <Loader2 size={14} className="spin" />
                              <span>Printing...</span>
                            </>
                          ) : isFailed ? (
                            <>
                              <RotateCcw size={14} />
                              <span>Retry Print</span>
                            </>
                          ) : (
                            <>
                              <Zap size={14} />
                              <span>Direct Print</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Job Card Body: Files List */}
                <div className="owner-job-files-container">
                  {job.files.map((file, idx) => {
                    const fileKey = `${job.id}_${file.fileId || idx}`;
                    const override = fileOverrides[fileKey];
                    const assignedPrinter =
                      override ||
                      file.assignedPrinter ||
                      defaultPrinterName ||
                      "Auto (Pool)";

                    return (
                      <div
                        key={file.fileId || idx}
                        className="owner-file-item"
                      >
                        <div className="owner-file-details">
                          <FileText size={15} className="owner-file-icon" />
                          <span
                            className="owner-file-name-text"
                            title={file.filename}
                          >
                            {file.filename || `File ${idx + 1}`}
                          </span>
                          {file.pages ? (
                            <span className="owner-file-pages-badge">
                              {file.pages} {file.pages === 1 ? "page" : "pages"}
                            </span>
                          ) : null}
                        </div>

                        <div className="owner-file-printer-box">
                          <span
                            className="owner-file-printer-badge"
                            title={`Routed to: ${assignedPrinter}`}
                          >
                            <Printer size={12} />
                            <span className="assigned-printer-text">
                              {assignedPrinter}
                            </span>
                          </span>

                          {printers.length > 1 && showPrintButton && (
                            <div className="owner-file-printer-select-wrap">
                              <select
                                className="owner-file-printer-select"
                                value={override || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setFileOverrides((prev) => ({
                                    ...prev,
                                    [fileKey]: val,
                                  }));
                                }}
                                disabled={isDisabledForPrint}
                                title="Change printer for this specific file"
                              >
                                <option value="">Override...</option>
                                {printers.map((p) => (
                                  <option key={p.id || p.name} value={p.name}>
                                    {p.nickname || p.name} ({p.pool.toUpperCase()})
                                  </option>
                                ))}
                              </select>
                              <ChevronDown
                                size={11}
                                className="select-arrow-icon"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Failed Alert Banner */}
                {isFailed && (
                  <div className="job-failed-notice">
                    <AlertCircle size={14} />
                    <span>
                      Print failed. Verify printer power/cable or select a different
                      printer, then click <strong>Retry Print</strong>.
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};

export default OwnerModeQueue;
