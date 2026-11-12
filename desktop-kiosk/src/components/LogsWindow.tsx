import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText,
  RefreshCw,
  Copy,
  Check,
  Trash2,
  Search,
} from "lucide-react";
import { clearLogs, getLogs } from "../api/tauri";

type LogLevelFilter = "ALL" | "INFO" | "WARN" | "ERROR";

export const LogsWindow: React.FC = () => {
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<LogLevelFilter>("ALL");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [copied, setCopied] = useState(false);

  const fetchLogs = useCallback(async () => {
    try {
      const lines = await getLogs(500);
      setLogs(lines);
      setError("");
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to load application logs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => {
      fetchLogs();
    }, 3000);
    return () => window.clearInterval(id);
  }, [autoRefresh, fetchLogs]);

  const filteredLogs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return logs.filter((line) => {
      if (levelFilter !== "ALL") {
        const upper = line.toUpperCase();
        if (!upper.includes(`[${levelFilter}]`) && !upper.includes(` ${levelFilter} `)) {
          return false;
        }
      }
      if (query && !line.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
  }, [logs, levelFilter, search]);

  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(filteredLogs.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be restricted; ignore
    }
  };

  const handleClear = async () => {
    try {
      await clearLogs();
      setLogs([]);
      setError("");
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to clear logs.");
    }
  };

  const getLineClass = (line: string): string => {
    const upper = line.toUpperCase();
    if (upper.includes("[ERROR]") || upper.includes(" ERROR ")) return "log-line error";
    if (upper.includes("[WARN]") || upper.includes(" WARN ")) return "log-line warn";
    return "log-line";
  };

  return (
    <div className="logs-shell">
      <header className="kiosk-header">
        <div className="brand">
          <div className="brand-icon">
            <FileText size={20} color="#ffffff" />
          </div>
          <div>
            <div className="brand-title">JetPrint — Application Logs</div>
            <div className="brand-subtitle">
              {filteredLogs.length} of {logs.length} {logs.length === 1 ? "entry" : "entries"}
            </div>
          </div>
        </div>

        <div className="header-status">
          <label className="checkbox-row" style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>Auto-refresh</span>
          </label>

          <button type="button" className="btn-secondary" onClick={fetchLogs}>
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={handleCopyAll}
            disabled={filteredLogs.length === 0}
          >
            {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
            <span>{copied ? "Copied" : "Copy All"}</span>
          </button>

          <button
            type="button"
            className="btn-danger-outline"
            style={{ padding: "8px 12px", fontSize: 13 }}
            onClick={handleClear}
            disabled={logs.length === 0}
          >
            <Trash2 size={14} />
            <span>Clear Logs</span>
          </button>
        </div>
      </header>

      <div className="logs-toolbar">
        <div className="logs-search-wrap">
          <Search size={14} className="logs-search-icon" />
          <input
            type="text"
            className="logs-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter logs by keyword, job ID, or message..."
            aria-label="Search logs"
          />
        </div>

        <div className="queue-filter-group">
          {(["ALL", "INFO", "WARN", "ERROR"] as const).map((lvl) => (
            <button
              key={lvl}
              type="button"
              className={`filter-chip ${levelFilter === lvl ? "active" : ""}`}
              onClick={() => setLevelFilter(lvl)}
            >
              {lvl}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="status-banner error" style={{ maxWidth: "100%" }}>
          <span>{error}</span>
        </div>
      )}

      <div className="logs-viewport">
        {loading ? (
          <div className="logs-empty">Loading logs...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="logs-empty">
            {logs.length === 0 ? "No log entries recorded yet." : "No log entries match your filter."}
          </div>
        ) : (
          filteredLogs.map((line, idx) => (
            <div key={idx} className={getLineClass(line)}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
