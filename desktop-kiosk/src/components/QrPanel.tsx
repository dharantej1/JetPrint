import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { Smartphone, Sparkles } from "lucide-react";

interface QrPanelProps {
  relayUrl: string;
  machineId: string;
  bwPricePaise: number;
  colorPricePaise: number;
}

function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return Number.isInteger(rupees) ? `₹${rupees}` : `₹${rupees.toFixed(2)}`;
}

export const QrPanel: React.FC<QrPanelProps> = ({
  relayUrl,
  machineId,
  bwPricePaise,
  colorPricePaise,
}) => {
  const cleanRelay = relayUrl.replace(/\/+$/, "") || "http://localhost:3000";
  const uploadUrl = `${cleanRelay}/upload?machine_id=${encodeURIComponent(machineId)}`;

  return (
    <section className="panel-card qr-section">
      <div className="qr-badge">
        <Smartphone size={15} />
        <span>Instant Self-Service Printing</span>
      </div>

      <div>
        <h1 className="qr-heading">Scan to Upload &amp; Pay</h1>
        <p className="qr-subtext" style={{ marginTop: 6 }}>
          Point your phone camera at the QR code to upload PDF or image files and pay via UPI.
        </p>
      </div>

      <div className="qr-frame" aria-label="Upload QR Code">
        <QRCodeSVG
          value={uploadUrl}
          size={216}
          level="M"
          bgColor="#ffffff"
          fgColor="#0f172a"
        />
      </div>

      <div className="pricing-grid">
        <div className="price-chip">
          <span className="price-label">Black &amp; White</span>
          <span className="price-value">
            {formatPaise(bwPricePaise)} <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 500 }}>/ page</span>
          </span>
        </div>
        <div className="price-chip">
          <span className="price-label" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
            <Sparkles size={12} color="#818cf8" /> Color
          </span>
          <span className="price-value">
            {formatPaise(colorPricePaise)} <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 500 }}>/ page</span>
          </span>
        </div>
      </div>

      <div className="steps-row">
        <div className="step-item">
          <span className="step-num">1</span>
          <span>Scan QR</span>
        </div>
        <div className="step-item">
          <span className="step-num">2</span>
          <span>Upload &amp; Pay</span>
        </div>
        <div className="step-item">
          <span className="step-num">3</span>
          <span>Enter 6-Digit OTP</span>
        </div>
      </div>
    </section>
  );
};
