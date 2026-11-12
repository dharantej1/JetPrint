import React from "react";
import { Printer, RefreshCw, CheckCircle2, Clock, FileText } from "lucide-react";
import type { PrintJob } from "../types";

interface OwnerModeQueueProps {
  jobs: PrintJob[];
  onRefresh: () => void;
  onPrintJob: (otp: string) => void;
  printingOtp: string | null;
}

export const OwnerModeQueue: React.FC<OwnerModeQueueProps> = ({
  jobs,
  onRefresh,
  onPrintJob,
  printingOtp,
}) => {
  return (
    <section className="panel-card" style={{ gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Owner Mode — Print Queue</h2>
          <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 2 }}>
            Recent jobs received from Cloud Relay. Print directly or verify OTP.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={onRefresh}>
          <RefreshCw size={15} />
          <span>Refresh</span>
        </button>
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
            No print jobs in queue yet.
          </div>
        ) : (
          jobs.map((job) => {
            const isPrinted = job.status === "printed";
            return (
              <div key={job.id} className="job-row">
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <FileText size={15} color="#818cf8" />
                    <span style={{ fontWeight: 600 }}>OTP: {job.otp}</span>
                    <span style={{ color: "#94a3b8", fontSize: 12 }}>
                      • {job.copies} {job.copies === 1 ? "copy" : "copies"} •{" "}
                      {job.color ? "Color" : "B/W"} • {job.files.length} file(s)
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    {job.files.map((f) => f.filename || "Document").join(", ")}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 12,
                      fontWeight: 600,
                      color: isPrinted ? "#6ee7b7" : "#fbbf24",
                    }}
                  >
                    {isPrinted ? <CheckCircle2 size={14} /> : <Clock size={14} />}
                    {job.status}
                  </span>

                  <button
                    type="button"
                    className="btn-primary"
                    style={{ padding: "7px 12px", fontSize: 12 }}
                    disabled={printingOtp === job.otp}
                    onClick={() => onPrintJob(job.otp)}
                  >
                    <Printer size={14} />
                    <span>{printingOtp === job.otp ? "Printing..." : "Print"}</span>
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
