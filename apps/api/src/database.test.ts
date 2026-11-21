import { expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database';
import { createProviderKeyStore } from './secretStore';

test.each([1, 2])('upgrades a version %i SQLite database without losing user data', (version) => {
  const directory = mkdtempSync(join(tmpdir(), 'kuroko-sqlite-test-'));
  const path = join(directory, 'test.sqlite');
  const vaultKey = randomBytes(32);

  try {
    const old = openDatabase(path, vaultKey);
    try {
      old.run('INSERT INTO users (username, username_key, password_hash) VALUES (?, ?, ?)', ['Лина', 'лина', 'test-hash']);
      old.exec('DROP TABLE connection_presets; DROP TABLE provider_keys');
      if (version === 1) {
        old.exec('DROP TABLE chat_settings; PRAGMA user_version = 1');
      } else {
        old.run('INSERT INTO chat_settings (user_id, settings_json) VALUES (1, ?)', ['{"fontSize":20}']);
        old.exec('PRAGMA user_version = 2');
      }
    } finally {
      old.close();
    }

    const migrated = openDatabase(path, vaultKey);
    try {
      expect(migrated.query('PRAGMA user_version').get()).toEqual({ user_version: 4 });
      expect(migrated.query('SELECT username FROM users').all()).toEqual([{ username: 'Лина' }]);
      expect(migrated.query('SELECT settings_json FROM chat_settings').all()).toEqual(version === 1 ? [] : [{ settings_json: '{"fontSize":20}' }]);
      expect(migrated.query('SELECT * FROM connection_presets').all()).toEqual([]);
    } finally {
      migrated.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('imports a previously shared encrypted key into separate provider managers and preserves the active preset', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kuroko-sqlite-test-'));
  const path = join(directory, 'test.sqlite');
  const vaultKey = randomBytes(32);

  try {
    const old = openDatabase(path, vaultKey);
    try {
      old.run('INSERT INTO users (username, username_key, password_hash) VALUES (?, ?, ?)', ['Лина', 'лина', 'test-hash']);
      const store = createProviderKeyStore(old, vaultKey);
      const shared = store.create(1, 'openai', 'Shared key', 'test-shared-value');
      if (!shared) throw new Error('Missing legacy key');
      store.create(1, 'openai', 'Unlinked key', 'test-unlinked-value');
      old.exec(`
        DROP TABLE connection_presets;
        DROP TABLE provider_keys;
        CREATE TABLE connection_settings (
          user_id INTEGER, provider TEXT, settings_json TEXT, secret_id TEXT, active INTEGER,
          PRIMARY KEY (user_id, provider)
        ) STRICT;
        PRAGMA user_version = 3;
      `);
      old.run('INSERT INTO connection_settings VALUES (1, ?, ?, ?, 0), (1, ?, ?, ?, 1)',
        ['openai', '{"model":"openai-model"}', shared.id, 'gemini', '{"model":"gemini-model"}', shared.id]);
    } finally {
      old.close();
    }

    const migrated = openDatabase(path, vaultKey);
    try {
      const store = createProviderKeyStore(migrated, vaultKey);
      const keys = store.list(1);
      const openai = keys.find((key) => key.provider === 'openai');
      const gemini = keys.find((key) => key.provider === 'gemini');
      if (!openai || !gemini) throw new Error('Missing migrated provider keys');
      expect(keys).toHaveLength(2);
      expect(openai.id).not.toBe(gemini.id);
      expect(store.getForProvider(1, 'openai', openai.id)).toBe('test-shared-value');
      expect(store.getForProvider(1, 'openai', gemini.id)).toBeNull();
      expect(migrated.query('SELECT name, key_id, active FROM connection_presets ORDER BY active DESC').all()).toEqual([
        { name: 'Google Gemini', key_id: gemini.id, active: 1 }, { name: 'OpenAI', key_id: openai.id, active: 0 },
      ]);
      expect(store.remove(1, 'openai', openai.id)).toBe(true);
      expect(store.getForProvider(1, 'gemini', gemini.id)).toBe('test-shared-value');
      expect(migrated.query('SELECT key_id FROM connection_presets WHERE provider = ?').get('openai')).toEqual({ key_id: null });
    } finally {
      migrated.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
