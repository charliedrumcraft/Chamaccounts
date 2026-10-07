/**
 * Ouverture / fermeture de transactions.db (sql.js — SQLite WASM, sans module natif).
 */

import type { Database } from 'sql.js';
import * as path from 'path';
import { TRANSACTIONS_DB_PATH } from '../../shared/dataPaths';
import {
  closeSqlJsDatabase,
  openSqlJsDatabaseFile,
  persistSqlJsDatabase,
  queryOne,
  type SqlJsDbHandle,
} from './sqlJsRuntime';

export { queryOne, queryAll } from './sqlJsRuntime';

const SCHEMA_VERSION = 2;

let handle: SqlJsDbHandle | null = null;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idx INTEGER NOT NULL,
    date TEXT NOT NULL DEFAULT '',
    date_ms INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '',
    amount TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT '',
    account TEXT NOT NULL DEFAULT '',
    amount_gbp TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT '',
    projet TEXT NOT NULL DEFAULT '',
    exclure_anomalie TEXT NOT NULL DEFAULT '',
    soutien_ignorer TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_transactions_idx ON transactions(idx);
  CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
  CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
  CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account);
`;

function tableHasColumn(database: Database, table: string, column: string): boolean {
  const cols = database.exec(`PRAGMA table_info(${table})`);
  if (!cols.length) return false;
  const values = cols[0].values ?? [];
  return values.some((row) => String(row[1]) === column);
}

function ensureSchema(database: Database): void {
  // Ne pas créer idx_transactions_date_ms ici : sur une DB phase 1 sans colonne,
  // CREATE INDEX …(date_ms) échoue avant l’ALTER.
  database.run(SCHEMA_SQL);
  if (!tableHasColumn(database, 'transactions', 'date_ms')) {
    database.run('ALTER TABLE transactions ADD COLUMN date_ms INTEGER NOT NULL DEFAULT 0');
  }
  database.run(
    'CREATE INDEX IF NOT EXISTS idx_transactions_date_ms ON transactions(date_ms)'
  );
  const existing = queryOne(database, 'SELECT value FROM meta WHERE key = ?', ['schema_version']);
  if (!existing) {
    database.run('INSERT INTO meta (key, value) VALUES (?, ?)', [
      'schema_version',
      String(SCHEMA_VERSION),
    ]);
  } else if (Number(existing.value) < SCHEMA_VERSION) {
    database.run('UPDATE meta SET value = ? WHERE key = ?', [
      String(SCHEMA_VERSION),
      'schema_version',
    ]);
  }
}

/** Persiste le fichier .db sur disque (sql.js est en mémoire). */
export function persistTransactionDb(): void {
  persistSqlJsDatabase(handle);
}

/** Ferme la DB ouverte s’il y en a une (après flush disque). */
export function closeTransactionDb(): void {
  closeSqlJsDatabase(handle);
  handle = null;
}

/**
 * Ouvre (ou réutilise) transactions.db pour ce dataRoot.
 * Crée le dossier Processed et le schéma si besoin.
 */
export async function openTransactionDb(dataRoot: string): Promise<Database> {
  const resolved = path.resolve(dataRoot);
  if (handle && handle.dataRoot === resolved) {
    return handle.db;
  }
  closeTransactionDb();
  handle = await openSqlJsDatabaseFile(dataRoot, TRANSACTIONS_DB_PATH);
  ensureSchema(handle.db);
  persistTransactionDb();
  return handle.db;
}

export function getOpenTransactionDb(): Database | null {
  return handle?.db ?? null;
}

export function getOpenTransactionDataRoot(): string | null {
  return handle?.dataRoot ?? null;
}
