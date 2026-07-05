import React, { useState, useEffect, useCallback } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

// =====================================================
// ClearBorder Admin — Order Updater
// =====================================================
// A separate site to edit order info. Writes to the
// versioned order store via PUT /api/orders/:ref.
// =====================================================

const API = "http://localhost:3001";
const WS_URL = "ws://localhost:3001/ws";
const DEFAULT_REF = "SHIP-RESTART-001";

interface OrderFields {
  invoiceValue?: number;
  packingListValue?: number;
  hsCode?: string;
  valueProofUrl?: string;
}

interface OrderSnapshot {
  ref: string;
  version: number;
  updatedAt: string;
  fields: OrderFields;
}

function App() {
  const [ref, setRef] = useState(DEFAULT_REF);
  const [order, setOrder] = useState<OrderSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [activityLog, setActivityLog] = useState<string[]>([]);

  // Form fields
  const [invoiceValue, setInvoiceValue] = useState("");
  const [packingListValue, setPackingListValue] = useState("");
  const [hsCode, setHsCode] = useState("");
  const [valueProofUrl, setValueProofUrl] = useState("");

  // Fetch order
  const fetchOrder = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/orders/${ref}`);
      const data = await res.json();
      if (data.error) {
        setOrder(null);
        setStatusMsg("Order not found — save to create it");
      } else {
        setOrder(data);
        setInvoiceValue(data.fields.invoiceValue?.toString() ?? "");
        setPackingListValue(data.fields.packingListValue?.toString() ?? "");
        setHsCode(data.fields.hsCode ?? "");
        setValueProofUrl(data.fields.valueProofUrl ?? "");
        setStatusMsg("");
      }
    } catch (err) {
      setStatusMsg("Failed to fetch — is the server running?");
    }
    setLoading(false);
  }, [ref]);

  useEffect(() => { fetchOrder(); }, [fetchOrder]);

  // WebSocket
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const ts = new Date().toLocaleTimeString();
        setActivityLog(prev => [`${ts} — ${msg.event}`, ...prev].slice(0, 30));

        // Auto-refresh on events
        if (msg.event === "order_changed" || msg.event === "correction_submitted" || msg.event === "cleared") {
          fetchOrder();
        }
      } catch {}
    };
    return () => ws.close();
  }, [fetchOrder]);

  // Save order
  const handleSave = async () => {
    setSaving(true);
    setStatusMsg("");
    try {
      const fields: OrderFields = {
        invoiceValue: invoiceValue ? parseFloat(invoiceValue) : undefined,
        packingListValue: packingListValue ? parseFloat(packingListValue) : undefined,
        hsCode: hsCode || undefined,
        valueProofUrl: valueProofUrl || undefined,
      };
      const res = await fetch(`${API}/api/orders/${ref}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      const data = await res.json();
      setOrder(data);
      setStatusMsg(`✅ Saved — version ${data.version}`);
      const ts = new Date().toLocaleTimeString();
      setActivityLog(prev => [`${ts} — Saved order v${data.version}`, ...prev].slice(0, 30));
    } catch (err) {
      setStatusMsg("❌ Failed to save");
    }
    setSaving(false);
  };

  return (
    <div className="admin-app">
      {/* Header */}
      <header className="admin-header">
        <div className="admin-header-left">
          <span className="admin-logo">🛃</span>
          <h1 className="admin-title">ClearBorder</h1>
          <span className="admin-badge">ADMIN</span>
        </div>
        <div className="admin-header-right">
          <span className={`ws-dot ${wsConnected ? "on" : ""}`}>
            {wsConnected ? "● Connected" : "○ Offline"}
          </span>
        </div>
      </header>

      {/* Main content */}
      <main className="admin-main">
        {/* Order Form */}
        <section className="admin-form-section">
          <div className="form-header">
            <h2 className="form-title">📦 Order Editor</h2>
            <div className="form-ref">
              <label>Shipment Ref:</label>
              <input
                type="text"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                className="ref-input"
              />
              <button className="btn-refresh" onClick={fetchOrder} disabled={loading}>
                {loading ? "…" : "↻"}
              </button>
            </div>
          </div>

          {order && (
            <div className="order-meta">
              <span className="meta-version">v{order.version}</span>
              <span className="meta-updated">Updated: {new Date(order.updatedAt).toLocaleString()}</span>
            </div>
          )}

          <div className="form-fields">
            <div className="form-group">
              <label>Invoice Value (€)</label>
              <input
                type="number"
                value={invoiceValue}
                onChange={(e) => setInvoiceValue(e.target.value)}
                placeholder="e.g. 47250"
                className="field-input"
              />
            </div>

            <div className="form-group">
              <label>Packing List Value (€)</label>
              <input
                type="number"
                value={packingListValue}
                onChange={(e) => setPackingListValue(e.target.value)}
                placeholder="e.g. 45000"
                className="field-input"
              />
            </div>

            <div className="form-group">
              <label>HS Code</label>
              <input
                type="text"
                value={hsCode}
                onChange={(e) => setHsCode(e.target.value)}
                placeholder="e.g. 8541.40.90"
                className="field-input"
              />
            </div>

            <div className="form-group">
              <label>Value Proof URL</label>
              <input
                type="text"
                value={valueProofUrl}
                onChange={(e) => setValueProofUrl(e.target.value)}
                placeholder="https://..."
                className="field-input"
              />
            </div>
          </div>

          <div className="form-actions">
            <button className="btn-save" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "💾 Save Order"}
            </button>
            {statusMsg && <span className={`status-msg ${statusMsg.startsWith("✅") ? "success" : statusMsg.startsWith("❌") ? "error" : ""}`}>{statusMsg}</span>}
          </div>

          <div className="form-hint">
            <p>💡 Saving triggers a version bump. The memory session will detect the change and reconcile automatically.</p>
          </div>
        </section>

        {/* Activity Log */}
        <section className="admin-activity">
          <h2 className="activity-title">📋 Activity Log</h2>
          <div className="activity-entries">
            {activityLog.length === 0 ? (
              <div className="activity-empty">No activity yet…</div>
            ) : (
              activityLog.map((entry, i) => (
                <div key={i} className="activity-entry">{entry}</div>
              ))
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="admin-footer">
        <span>ClearBorder Admin · Order Updater</span>
        <span>{order ? `${ref} · v${order.version}` : "No order loaded"}</span>
      </footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>
);
