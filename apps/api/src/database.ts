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

const connectionPresetsSchema = `
  CREATE TABLE provider_keys (
    id TEXT PRIMARY KEY,
    secret_id TEXT NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    UNIQUE (secret_id, provider)
  ) STRICT;

  CREATE TABLE connection_presets (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
    key_id TEXT REFERENCES provider_keys(id) ON DELETE SET NULL,
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    UNIQUE (user_id, name)
  ) STRICT;

  CREATE UNIQUE INDEX active_connection_preset ON connection_presets (user_id) WHERE active = 1;
  CREATE INDEX connection_preset_key ON connection_presets (key_id) WHERE key_id IS NOT NULL;
`;

const migrateConnections = `
  INSERT INTO provider_keys (id, secret_id, provider)
    SELECT lower(hex(randomblob(16))), secret.id, connection.provider
    FROM connection_settings AS connection
    JOIN secrets AS secret ON secret.id = connection.secret_id AND secret.user_id = connection.user_id;

  INSERT INTO connection_presets (id, user_id, name, provider, settings_json, key_id, active)
    SELECT lower(hex(randomblob(16))), connection.user_id,
      CASE connection.provider WHEN 'openai' THEN 'OpenAI' WHEN 'openrouter' THEN 'OpenRouter'
        WHEN 'anthropic' THEN 'Anthropic' WHEN 'gemini' THEN 'Google Gemini' ELSE connection.provider END,
      connection.provider, connection.settings_json, provider_keys.id, connection.active
    FROM connection_settings AS connection
    LEFT JOIN provider_keys ON provider_keys.secret_id = connection.secret_id AND provider_keys.provider = connection.provider
      AND EXISTS (SELECT 1 FROM secrets WHERE id = connection.secret_id AND user_id = connection.user_id);

  DROP TABLE connection_settings;
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
      } else if (version !== 1 && version !== 2 && version !== 3 && version !== 4) {
        throw new Error(`Unsupported SQLite schema version: ${version}`);
      }

      const stored = db.query<{ key_fingerprint: string }, []>(
        'SELECT key_fingerprint FROM vault_settings WHERE id = 1',
      ).get();
      if (stored?.key_fingerprint !== fingerprint) {
        throw new Error('The vault key does not match this SQLite database');
      }

      if (version === 0 || version === 1) {
        db.exec(chatSettingsSchema);
      }
      if (version !== 4) {
        db.exec(connectionPresetsSchema);
        if (version === 3) db.exec(migrateConnections);
        db.exec('PRAGMA user_version = 4');
      }
    }).immediate();
  } catch (error) {
    db.close();
    throw error;
  }

  return db;
}
