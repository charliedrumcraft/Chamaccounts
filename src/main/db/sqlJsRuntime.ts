/**
 * Runtime sql.js partagé (une seule init WASM) pour plusieurs bases ouvertes en parallèle.
 */

import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';

let SQL: SqlJsStatic | null = null;
let sqlReady: Promise<SqlJsStatic> | null = null;

/** Résout sql-wasm.wasm (et autres assets) hors asar si besoin. */
export function resolveSqlJsAsset(file: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require.resolve(`sql.js/dist/${file}`);
}

export async function getSql(): Promise<SqlJsStatic> {
  if (SQL) return SQL;
  if (!sqlReady) {
    sqlReady = initSqlJs({
      locateFile: (file: string) => resolveSqlJsAsset(file),
    }).then((instance) => {
      SQL = instance;
      return instance;
    });
  }
  return sqlReady;
}

/** Helper SELECT une ligne. */
export function queryOne(
  database: Database,
  sql: string,
  params: Array<string | number | null> = []
): Record<string, unknown> | undefined {
  const stmt = database.prepare(sql);
  try {
    stmt.bind(params);
    if (!stmt.step()) return undefined;
    return stmt.getAsObject() as Record<string, unknown>;
  } finally {
    stmt.free();
  }
}

/** Helper SELECT toutes les lignes. */
export function queryAll(
  database: Database,
  sql: string,
  params: Array<string | number | null> = []
): Record<string, unknown>[] {
  const stmt = database.prepare(sql);
  const rows: Record<string, unknown>[] = [];
  try {
    stmt.bind(params);
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as Record<string, unknown>);
    }
  } finally {
    stmt.free();
  }
  return rows;
}

export type SqlJsDbHandle = {
  db: Database;
  dataRoot: string;
  dbPath: string;
};

/** Nettoie -wal/-shm d’une éventuelle version better-sqlite3. */
export function cleanupSqliteSidecars(dbPath: string): void {
  for (const suffix of ['-wal', '-shm']) {
    const side = `${dbPath}${suffix}`;
    if (fs.existsSync(side)) {
      try {
        fs.unlinkSync(side);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Ouvre un fichier .db sql.js (crée le dossier parent).
 * En cas de fichier illisible : renomme en .bak-* et repart d’une DB vide.
 */
export async function openSqlJsDatabaseFile(
  dataRoot: string,
  relativeDbPath: string
): Promise<SqlJsDbHandle> {
  const sql = await getSql();
  const resolvedRoot = path.resolve(dataRoot);
  const dbPath = path.join(resolvedRoot, relativeDbPath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  cleanupSqliteSidecars(dbPath);

  let database: Database;
  if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
    try {
      const fileBuffer = fs.readFileSync(dbPath);
      database = new sql.Database(new Uint8Array(fileBuffer));
      database.exec('SELECT count(*) FROM sqlite_master');
    } catch (err) {
      console.warn(`${relativeDbPath} illisible, recréation:`, err);
      try {
        fs.renameSync(dbPath, `${dbPath}.bak-${Date.now()}`);
      } catch {
        /* ignore */
      }
      database = new sql.Database();
    }
  } else {
    database = new sql.Database();
  }

  return { db: database, dataRoot: resolvedRoot, dbPath };
}

export function persistSqlJsDatabase(handle: SqlJsDbHandle | null): void {
  if (!handle) return;
  const data = handle.db.export();
  fs.writeFileSync(handle.dbPath, Buffer.from(data));
}

export function closeSqlJsDatabase(handle: SqlJsDbHandle | null): void {
  if (!handle) return;
  try {
    persistSqlJsDatabase(handle);
    handle.db.close();
  } catch {
    /* ignore */
  }
}
