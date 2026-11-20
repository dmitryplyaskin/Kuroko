import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';

const schema = `
  CREATE TABLE vault_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    key_fingerprint TEXT NOT NULL
  ) STRICT;

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    username_key TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  ) STRICT;

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX sessions_expiry ON sessions (expires_at);

  CREATE TABLE secrets (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    encrypted_value BLOB NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX secrets_owner ON secrets (user_id, created_at DESC, id);
`;

const chatSettingsSchema = `
  CREATE TABLE chat_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings_json TEXT NOT NULL CHECK (json_valid(settings_json))
  ) STRICT;
`;

export function openDatabase(path: string, vaultKey: Buffer) {
  const db = new Database(path, { strict: true });
  const fingerprint = createHash('sha256').update(vaultKey).digest('hex');

  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

    db.transaction(() => {
      const version = db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version;
      if (version === 0) {
        db.exec(schema);
        db.run('INSERT INTO vault_settings (id, key_fingerprint) VALUES (1, ?)', [fingerprint]);
      } else if (version !== 1 && version !== 2) {
        throw new Error(`Unsupported SQLite schema version: ${version}`);
      }

      const stored = db.query<{ key_fingerprint: string }, []>(
        'SELECT key_fingerprint FROM vault_settings WHERE id = 1',
      ).get();
      if (stored?.key_fingerprint !== fingerprint) {
        throw new Error('The vault key does not match this SQLite database');
      }

      if (version !== 2) {
        db.exec(chatSettingsSchema);
        db.exec('PRAGMA user_version = 2');
      }
    }).immediate();
  } catch (error) {
    db.close();
    throw error;
  }

  return db;
}
