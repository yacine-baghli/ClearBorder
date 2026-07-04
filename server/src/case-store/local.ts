// server/src/case-store/local.ts
// LocalCaseStore — SQLite-backed implementation of CaseStore.
// The demo-safe default: proves "state survives a full session close and resumes."

import Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import type { CaseFile, CaseStore, Discrepancy } from "@clearborder/core";

export class LocalCaseStore implements CaseStore {
  private db: Database.Database;

  constructor(dbPath: string = "clearborder.db") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cases (
        case_id       TEXT PRIMARY KEY,
        environment_id TEXT NOT NULL UNIQUE,
        data          TEXT NOT NULL,
        last_touched_at TEXT NOT NULL,
        day           INTEGER NOT NULL DEFAULT 1
      );
    `);
  }

  async create(seed: Partial<CaseFile>): Promise<CaseFile> {
    const now = new Date().toISOString();
    const caseFile: CaseFile = {
      caseId: seed.caseId ?? uuid(),
      environmentId: seed.environmentId ?? uuid(),
      shipment: seed.shipment ?? { ref: "", origin: "", destination: "" },
      documents: seed.documents ?? {},
      discrepancies: seed.discrepancies ?? [],
      openQueries: seed.openQueries ?? [],
      corrections: seed.corrections ?? [],
      lastTouchedAt: now,
      day: seed.day ?? 1,
    };

    this.db.prepare(`
      INSERT INTO cases (case_id, environment_id, data, last_touched_at, day)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      caseFile.caseId,
      caseFile.environmentId,
      JSON.stringify(caseFile),
      caseFile.lastTouchedAt,
      caseFile.day,
    );

    return caseFile;
  }

  async get(caseId: string): Promise<CaseFile | null> {
    const row = this.db.prepare(
      "SELECT data FROM cases WHERE case_id = ?"
    ).get(caseId) as { data: string } | undefined;

    if (!row) return null;
    return JSON.parse(row.data) as CaseFile;
  }

  async resume(environmentId: string): Promise<CaseFile | null> {
    const row = this.db.prepare(
      "SELECT data FROM cases WHERE environment_id = ?"
    ).get(environmentId) as { data: string } | undefined;

    if (!row) return null;

    const caseFile = JSON.parse(row.data) as CaseFile;

    // Increment day and refresh TTL on resume
    caseFile.day += 1;
    caseFile.lastTouchedAt = new Date().toISOString();

    this.db.prepare(`
      UPDATE cases SET data = ?, last_touched_at = ?, day = ?
      WHERE environment_id = ?
    `).run(
      JSON.stringify(caseFile),
      caseFile.lastTouchedAt,
      caseFile.day,
      environmentId,
    );

    return caseFile;
  }

  async append(caseId: string, patch: Partial<CaseFile>): Promise<CaseFile> {
    const existing = await this.get(caseId);
    if (!existing) throw new Error(`Case ${caseId} not found`);

    const now = new Date().toISOString();

    // Merge documents (shallow merge per doc kind)
    if (patch.documents) {
      existing.documents = { ...existing.documents, ...patch.documents };
    }

    // Append arrays
    if (patch.discrepancies) {
      existing.discrepancies = [
        ...existing.discrepancies,
        ...patch.discrepancies,
      ];
    }
    if (patch.openQueries) {
      existing.openQueries = [...existing.openQueries, ...patch.openQueries];
    }
    if (patch.corrections) {
      existing.corrections = [...existing.corrections, ...patch.corrections];
    }

    // Update shipment if provided
    if (patch.shipment) {
      existing.shipment = { ...existing.shipment, ...patch.shipment };
    }

    existing.lastTouchedAt = now;

    this.db.prepare(`
      UPDATE cases SET data = ?, last_touched_at = ?
      WHERE case_id = ?
    `).run(JSON.stringify(existing), now, caseId);

    return existing;
  }

  async detectDiscrepancies(caseId: string): Promise<Discrepancy[]> {
    const caseFile = await this.get(caseId);
    if (!caseFile) throw new Error(`Case ${caseId} not found`);

    const newDiscrepancies: Discrepancy[] = [];
    const now = new Date().toISOString();

    // Rule 1: value_mismatch — invoice vs packing_list
    const invoiceDoc = caseFile.documents.invoice;
    const packingDoc = caseFile.documents.packing_list;

    if (invoiceDoc && packingDoc && invoiceDoc.value !== packingDoc.value) {
      const alreadyExists = caseFile.discrepancies.some(
        (d) => d.kind === "value_mismatch_invoice_vs_packing_list"
      );
      if (!alreadyExists) {
        newDiscrepancies.push({
          id: uuid(),
          kind: "value_mismatch_invoice_vs_packing_list",
          detail: `Invoice declares "${invoiceDoc.value}" but packing list states "${packingDoc.value}". These values must match for customs clearance.`,
          status: "open",
          openedAt: now,
        });
      }
    }

    // Rule 2: missing_hs_code
    if (!caseFile.shipment.hsCode) {
      const alreadyExists = caseFile.discrepancies.some(
        (d) => d.kind === "missing_hs_code"
      );
      if (!alreadyExists) {
        newDiscrepancies.push({
          id: uuid(),
          kind: "missing_hs_code",
          detail: `HS (Harmonized System) code is missing from the shipment record. This is required for tariff classification and customs clearance.`,
          status: "open",
          openedAt: now,
        });
      }
    }

    // Persist any new discrepancies
    if (newDiscrepancies.length > 0) {
      await this.append(caseId, { discrepancies: newDiscrepancies });
    }

    return newDiscrepancies;
  }

  /** Close the database connection */
  close(): void {
    this.db.close();
  }

  /** Directly update discrepancy statuses in the persisted CaseFile */
  async updateDiscrepancyStatus(caseId: string, discrepancies: Discrepancy[]): Promise<void> {
    const caseFile = await this.get(caseId);
    if (!caseFile) throw new Error(`Case ${caseId} not found`);

    caseFile.discrepancies = discrepancies;
    caseFile.lastTouchedAt = new Date().toISOString();

    this.db.prepare(`
      UPDATE cases SET data = ?, last_touched_at = ?
      WHERE case_id = ?
    `).run(JSON.stringify(caseFile), caseFile.lastTouchedAt, caseId);
  }
}
