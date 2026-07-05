// packages/core/src/case.ts
// The load-bearing abstraction — every component depends on this.

export type DocKind = "invoice" | "packing_list" | "hs_code" | "value_proof";

export interface Discrepancy {
  id: string;
  kind: string;                 // e.g. "value_mismatch_invoice_vs_packing_list"
  detail: string;               // human-readable
  status: "open" | "amended" | "confirmed" | "submitted";
  openedAt: string;
  resolvedAt?: string;
}

export interface CustomsQuery {           // a question the portal/authority is waiting on
  id: string;
  question: string;
  answer?: string;
  status: "pending" | "answered";
}

export interface Correction {
  at: string;
  field: string;
  from?: string;
  to: string;
  by: "agent" | "human";
}

export interface Shipment {
  ref: string;
  origin: string;
  destination: string;
  hsCode?: string;
}

export interface CaseFile {
  caseId: string;
  environmentId: string;        // the resume key — TTL resets on use
  shipment: Shipment;
  documents: Partial<Record<DocKind, { value: string; source: "call" | "portal" | "upload" }>>;
  discrepancies: Discrepancy[];
  openQueries: CustomsQuery[];
  corrections: Correction[];
  lastTouchedAt: string;
  day: number;                  // demo clock: 1, 2, ...
}

export interface CaseStore {
  create(seed: Partial<CaseFile>): Promise<CaseFile>;
  get(caseId: string): Promise<CaseFile | null>;
  resume(environmentId: string): Promise<CaseFile | null>;   // <- the money method
  append(caseId: string, patch: Partial<CaseFile>): Promise<CaseFile>;
  detectDiscrepancies(caseId: string): Promise<Discrepancy[]>;
}

// ── Live Product Mode types ──

/** A versioned order snapshot — the source of truth the updater edits. */
export interface OrderSnapshot {
  ref: string;                 // shipment/order ref — links to the CaseFile
  version: number;             // bumped on every update
  updatedAt: string;
  fields: {
    invoiceValue?: number;
    packingListValue?: number;
    hsCode?: string;
    valueProofUrl?: string;
  };
}

/** Tracks what the memory session has already reconciled on a CaseFile. */
export interface CaseSessionState {
  environmentId: string;
  caseId: string;
  lastProcessedOrderVersion: number;   // idempotency marker
  lastCheckedAt?: string;
  nextCheckAt?: string;
  status: "idle" | "checking" | "reconciling" | "awaiting_approval";
}
