// server/src/orderStore.ts
// =====================================================================
// Versioned Order Store — source of truth for order info
// =====================================================================
// Persisted via better-sqlite3, same approach as CaseStore.
// Keyed by shipment ref. Each PUT bumps version + updatedAt.
// =====================================================================

import Database from "better-sqlite3";
import type { OrderSnapshot } from "@clearborder/core";

export class OrderStore {
  private db: Database.Database;

  constructor(dbPath = "clearborder.db") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        ref TEXT PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        invoice_value REAL,
        packing_list_value REAL,
        hs_code TEXT,
        value_proof_url TEXT
      )
    `);
  }

  /** Get the current order snapshot by ref */
  get(ref: string): OrderSnapshot | null {
    const row = this.db.prepare("SELECT * FROM orders WHERE ref = ?").get(ref) as any;
    if (!row) return null;
    return this.rowToSnapshot(row);
  }

  /** Create or update an order — bumps version and updatedAt */
  upsert(ref: string, fields: OrderSnapshot["fields"]): OrderSnapshot {
    const existing = this.get(ref);
    const now = new Date().toISOString();

    if (existing) {
      const newVersion = existing.version + 1;
      this.db.prepare(`
        UPDATE orders SET
          version = ?,
          updated_at = ?,
          invoice_value = ?,
          packing_list_value = ?,
          hs_code = ?,
          value_proof_url = ?
        WHERE ref = ?
      `).run(
        newVersion, now,
        fields.invoiceValue ?? existing.fields.invoiceValue ?? null,
        fields.packingListValue ?? existing.fields.packingListValue ?? null,
        fields.hsCode ?? existing.fields.hsCode ?? null,
        fields.valueProofUrl ?? existing.fields.valueProofUrl ?? null,
        ref
      );
      return this.get(ref)!;
    } else {
      this.db.prepare(`
        INSERT INTO orders (ref, version, updated_at, invoice_value, packing_list_value, hs_code, value_proof_url)
        VALUES (?, 1, ?, ?, ?, ?, ?)
      `).run(
        ref, now,
        fields.invoiceValue ?? null,
        fields.packingListValue ?? null,
        fields.hsCode ?? null,
        fields.valueProofUrl ?? null
      );
      return this.get(ref)!;
    }
  }

  /** Seed a default order (for demo bootstrap) */
  seed(ref: string): OrderSnapshot {
    const existing = this.get(ref);
    if (existing) return existing;
    return this.upsert(ref, {
      invoiceValue: 47250,
      packingListValue: 45000,
      hsCode: "8541.40.90",
    });
  }

  /** List all orders */
  list(): OrderSnapshot[] {
    const rows = this.db.prepare("SELECT * FROM orders ORDER BY updated_at DESC").all() as any[];
    return rows.map(r => this.rowToSnapshot(r));
  }

  /** Reset all orders (for demo reset) */
  reset(): void {
    this.db.exec("DELETE FROM orders");
  }

  private rowToSnapshot(row: any): OrderSnapshot {
    return {
      ref: row.ref,
      version: row.version,
      updatedAt: row.updated_at,
      fields: {
        invoiceValue: row.invoice_value ?? undefined,
        packingListValue: row.packing_list_value ?? undefined,
        hsCode: row.hs_code ?? undefined,
        valueProofUrl: row.value_proof_url ?? undefined,
      },
    };
  }

  close(): void {
    this.db.close();
  }
}
