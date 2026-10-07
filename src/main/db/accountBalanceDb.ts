/**
 * Ouverture / fermeture de account_balance.db (sql.js, schéma EAV).
 */

import type { Database } from 'sql.js';
import * as path from 'path';
import { ACCOUNT_BALANCE_DB_PATH } from '../../shared/dataPaths';
import {
  closeSqlJsDatabase,
  openSqlJsDatabaseFile,
  persistSqlJsDatabase,
  queryOne,
  type SqlJsDbHandle,
} from './sqlJsRuntime';

const SCHEMA_VERSION = 1;

let handle: SqlJsDbHandle | null = null;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS balance_snapshots (
    date_key TEXT PRIMARY KEY NOT NULL
  );

  CREATE TABLE IF NOT EXISTS balance_amounts (
    date_key TEXT NOT NULL,
    account_code TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (date_key, account_code)
  );

  CREATE INDEX IF NOT EXISTS idx_balance_amounts_account ON balance_amounts(account_code);
  CREATE INDEX IF NOT EXISTS idx_balance_amounts_date ON balance_amounts(date_key);
`;

function ensureSchema(database: Database): void {
  database.run(SCHEMA_SQL);
  const existing = queryOne(database, 'SELECT value FROM meta WHERE key = ?', ['schema_version']);
  if (!existing) {
    database.run('INSERT INTO meta (key, value) VALUES (?, ?)', [
      'schema_version',
      String(SCHEMA_VERSION),
    ]);
  }
}

export function persistAccountBalanceDb(): void {
  persistSqlJsDatabase(handle);
}

export function closeAccountBalanceDb(): void {
  closeSqlJsDatabase(handle);
  handle = null;
}

export async function openAccountBalanceDb(dataRoot: string): Promise<Database> {
  const resolved = path.resolve(dataRoot);
  if (handle && handle.dataRoot === resolved) {
    return handle.db;
  }
  closeAccountBalanceDb();
  handle = await openSqlJsDatabaseFile(dataRoot, ACCOUNT_BALANCE_DB_PATH);
  ensureSchema(handle.db);
  persistAccountBalanceDb();
  return handle.db;
}

export function getOpenAccountBalanceDataRoot(): string | null {
  return handle?.dataRoot ?? null;
}
