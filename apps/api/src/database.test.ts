import { expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database';

test('upgrades a version 1 SQLite database without losing its accounts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kuroko-sqlite-test-'));
  const path = join(directory, 'test.sqlite');
  const vaultKey = randomBytes(32);

  try {
    const old = openDatabase(path, vaultKey);
    try {
      old.run('INSERT INTO users (username, username_key, password_hash) VALUES (?, ?, ?)', ['Лина', 'лина', 'test-hash']);
      old.exec('DROP TABLE chat_settings; PRAGMA user_version = 1');
    } finally {
      old.close();
    }

    const migrated = openDatabase(path, vaultKey);
    try {
      expect(migrated.query('PRAGMA user_version').get()).toEqual({ user_version: 2 });
      expect(migrated.query('SELECT username FROM users').all()).toEqual([{ username: 'Лина' }]);
      expect(migrated.query('SELECT * FROM chat_settings').all()).toEqual([]);
    } finally {
      migrated.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
