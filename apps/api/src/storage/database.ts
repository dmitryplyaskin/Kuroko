import { Database } from 'bun:sqlite';
import { migrateDatabase } from './migrations';

export function openDatabase(path: string, vaultKey: Buffer) {
  const db = new Database(path, { strict: true });

  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    migrateDatabase(db, vaultKey);
  } catch (error) {
    db.close();
    throw error;
  }

  return db;
}
