/**
 * Ouverture / fermeture de support.db (sql.js).
 */

import type { Database } from 'sql.js';
import * as path from 'path';
import { SUPPORT_DB_PATH } from '../../shared/dataPaths';
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

  CREATE TABLE IF NOT EXISTS support_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idx INTEGER NOT NULL,
    date TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    amount TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT '',
    amount_gbp TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    projet TEXT NOT NULL DEFAULT '',
    exclure_anomalie TEXT NOT NULL DEFAULT '',
    soutien_ignorer TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_support_rows_idx ON support_rows(idx);
  CREATE INDEX IF NOT EXISTS idx_support_rows_date ON support_rows(date);
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

export function persistSupportDb(): void {
  persistSqlJsDatabase(handle);
}

export function closeSupportDb(): void {
  closeSqlJsDatabase(handle);
  handle = null;
}

export async function openSupportDb(dataRoot: string): Promise<Database> {
  const resolved = path.resolve(dataRoot);
  if (handle && handle.dataRoot === resolved) {
    return handle.db;
  }
  closeSupportDb();
  handle = await openSqlJsDatabaseFile(dataRoot, SUPPORT_DB_PATH);
  ensureSchema(handle.db);
  persistSupportDb();
  return handle.db;
}

export function getOpenSupportDataRoot(): string | null {
  return handle?.dataRoot ?? null;
}
