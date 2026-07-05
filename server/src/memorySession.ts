// server/src/memorySession.ts
// =====================================================================
// Memory Session Worker — Scheduled Check + Diff + Reconcile
// =====================================================================
// Checks for order updates on a configurable interval. On each tick:
//   1. resume(environmentId) — reloads the CaseFile
//   2. Diff order.version vs lastProcessedOrderVersion
//   3. If delta: reconcile (re-detect discrepancies, drive pipeline)
//   4. If no delta: no-op
//
// The version marker (lastProcessedOrderVersion) is the idempotency key:
// a timer + instant trigger can never double-process the same version.
// =====================================================================

import { broadcast } from "./events.js";
import type { CaseSessionState, OrderSnapshot } from "@clearborder/core";

// --- In-memory session state (one per case for the demo) ---
const sessions = new Map<string, CaseSessionState>();

// --- Dependencies injected at init ---
let _caseStore: any;
let _orderStore: any;
let _startCorrection: any;
let _intervalMs: number;
let _intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize the memory session worker.
 * Called once on server startup.
 */
export function initMemorySession(opts: {
  caseStore: any;
  orderStore: any;
  startCorrection: (caseFile: any, discrepancyId: string) => Promise<any>;
  intervalMs?: number;
}) {
  _caseStore = opts.caseStore;
  _orderStore = opts.orderStore;
  _startCorrection = opts.startCorrection;
  _intervalMs = opts.intervalMs ?? parseInt(process.env.SESSION_INTERVAL_MS ?? "20000", 10);

  console.log(`🧠 Memory session worker initialized (interval: ${_intervalMs}ms)`);
}

/**
 * Start the periodic check loop.
 */
export function startSessionLoop() {
  if (_intervalHandle) return;
  _intervalHandle = setInterval(() => {
    checkAllCases();
  }, _intervalMs);
  console.log(`🔄 Session loop started (every ${_intervalMs / 1000}s)`);
}

/**
 * Stop the periodic check loop.
 */
export function stopSessionLoop() {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
}

/**
 * Register a case for monitoring.
 * Links a caseId + environmentId to an order ref.
 */
export function registerSession(caseId: string, environmentId: string, orderRef: string): CaseSessionState {
  const state: CaseSessionState = {
    environmentId,
    caseId,
    lastProcessedOrderVersion: 0,
    lastCheckedAt: undefined,
    nextCheckAt: new Date(Date.now() + _intervalMs).toISOString(),
    status: "idle",
  };
  sessions.set(caseId, state);

  // Initialize from current order version
  const order = _orderStore.get(orderRef);
  if (order) {
    // Set to current version so we don't trigger on existing data
    state.lastProcessedOrderVersion = order.version;
  }

  return state;
}

/**
 * Check all registered cases for order changes.
 */
async function checkAllCases() {
  for (const [caseId, session] of sessions) {
    await checkCase(caseId);
  }
}

/**
 * Check a single case for order changes.
 * This is called both by the scheduler and by the instant trigger.
 */
export async function checkCase(caseId: string): Promise<void> {
  const session = sessions.get(caseId);
  if (!session) return;
  if (session.status === "reconciling" || session.status === "awaiting_approval") return;

  session.status = "checking";
  session.lastCheckedAt = new Date().toISOString();
  session.nextCheckAt = new Date(Date.now() + _intervalMs).toISOString();

  broadcast("session_check", {
    caseId,
    status: session.status,
    lastCheckedAt: session.lastCheckedAt,
    lastProcessedOrderVersion: session.lastProcessedOrderVersion,
  });

  // Get the CaseFile
  const caseFile = await _caseStore.get(caseId);
  if (!caseFile) {
    session.status = "idle";
    return;
  }

  // Get the linked order
  const order: OrderSnapshot | null = _orderStore.get(caseFile.shipment.ref);
  if (!order) {
    session.status = "idle";
    return;
  }

  // --- Idempotency check ---
  if (order.version <= session.lastProcessedOrderVersion) {
    // No change — no-op
    session.status = "idle";
    return;
  }

  // --- Material change detected ---
  session.status = "reconciling";
  broadcast("order_changed", {
    caseId,
    ref: order.ref,
    version: order.version,
    previousVersion: session.lastProcessedOrderVersion,
    fields: order.fields,
  });

  // Update the case documents from the order snapshot
  const docPatch: any = {};
  if (order.fields.invoiceValue !== undefined) {
    docPatch.invoice = { value: `€${order.fields.invoiceValue.toLocaleString("en", { minimumFractionDigits: 2 })}`, source: "upload" as const };
  }
  if (order.fields.packingListValue !== undefined) {
    docPatch.packing_list = { value: `€${order.fields.packingListValue.toLocaleString("en", { minimumFractionDigits: 2 })}`, source: "upload" as const };
  }
  if (order.fields.hsCode) {
    docPatch.hs_code = { value: order.fields.hsCode, source: "upload" as const };
  }

  // Append updated documents
  await _caseStore.append(caseId, {
    documents: docPatch,
    shipment: {
      ...caseFile.shipment,
      hsCode: order.fields.hsCode ?? caseFile.shipment.hsCode,
    },
  });

  // Broadcast fact captures for the office UI
  for (const [key, val] of Object.entries(docPatch)) {
    broadcast("fact_captured", {
      caseId,
      docKind: key,
      value: (val as any).value,
      source: "order_update",
    });
  }

  // Re-detect discrepancies
  const newDiscs = await _caseStore.detectDiscrepancies(caseId);
  if (newDiscs.length > 0) {
    for (const d of newDiscs) {
      broadcast("discrepancy_detected", {
        caseId,
        discrepancy: d,
      });
    }

    // Start Computer Use correction for the first new discrepancy
    const updatedCase = await _caseStore.get(caseId);
    if (updatedCase) {
      const openDisc = updatedCase.discrepancies.find((d: any) => d.status === "open");
      if (openDisc) {
        session.status = "awaiting_approval";
        try {
          await _startCorrection(updatedCase, openDisc.id);
        } catch (err) {
          console.error("Computer Use correction failed:", err);
          session.status = "idle";
        }
      }
    }
  } else {
    // No new discrepancies — check if all existing ones are resolved
    const updatedCase = await _caseStore.get(caseId);
    if (updatedCase) {
      const allResolved = updatedCase.discrepancies.every((d: any) => d.status !== "open");
      if (allResolved && updatedCase.discrepancies.length > 0) {
        broadcast("cleared", { caseId, message: "All discrepancies resolved" });
      }
    }
    session.status = "idle";
  }

  // Advance the version marker (idempotency)
  session.lastProcessedOrderVersion = order.version;
}

/**
 * Get session status for the HUD.
 */
export function getSessionStatus(caseId: string): CaseSessionState | null {
  return sessions.get(caseId) ?? null;
}

/**
 * Mark session as idle (called after confirm/reject).
 */
export function markSessionIdle(caseId: string) {
  const session = sessions.get(caseId);
  if (session) {
    session.status = "idle";
  }
}

/**
 * List all sessions.
 */
export function listSessions(): CaseSessionState[] {
  return Array.from(sessions.values());
}
