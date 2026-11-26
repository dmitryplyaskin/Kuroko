import { expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database';
import { createProviderKeyStore } from '../connection/providerKeyStore';

test.each([1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])('upgrades a version %i SQLite database without losing user data', (version) => {
  const directory = mkdtempSync(join(tmpdir(), 'kuroko-sqlite-test-'));
  const path = join(directory, 'test.sqlite');
  const vaultKey = randomBytes(32);
  const legacyAgent = {
    id: 'old-agent', user_id: 1, name: 'Кубики', name_key: 'кубики', description: 'Бросает кубики',
    instructions: 'Записывай результат', tools_json: '["roll_dice"]',
  };
  const legacyTool = version < 15 ? 'delegate_task' : 'subagent';

  try {
    const old = openDatabase(path, vaultKey);
    try {
      old.exec(`
        DROP TRIGGER connection_presets_key_revision;
        DROP TRIGGER instruction_presets_world_revision;
        ALTER TABLE connection_presets DROP COLUMN revision;
        ALTER TABLE instruction_presets DROP COLUMN revision;
      `);
      if (version < 20) old.exec('DROP TRIGGER agents_world_revision; ALTER TABLE agents DROP COLUMN revision');
      old.run('INSERT INTO users (username, username_key, password_hash) VALUES (?, ?, ?)', ['Лина', 'лина', 'test-hash']);
      if (version < 17) old.exec('DROP TABLE instruction_presets');
      else {
        if (version < 19) old.exec('ALTER TABLE instruction_presets DROP COLUMN world_id');
        old.exec("INSERT INTO instruction_presets (id, user_id, name, text, active) VALUES ('old-instruction', 1, 'Стиль', '{{ literal }}', 1)");
      }
      if (version === 18) old.exec('ALTER TABLE instruction_presets ADD COLUMN template INTEGER NOT NULL DEFAULT 0');
      if (version < 16) old.exec('DROP TABLE temporary_agent_tools');
      if (version < 15) old.exec('DROP TABLE agents');
      else {
        if (version < 19) old.exec('ALTER TABLE agents DROP COLUMN world_id');
        if (version === 18) old.exec('ALTER TABLE agents ADD COLUMN template INTEGER NOT NULL DEFAULT 0');
        if (version < 16) old.exec('CREATE UNIQUE INDEX agents_v15_name ON agents (user_id, name_key)');
        old.run('INSERT INTO agents (id, user_id, name, name_key, description, instructions, tools_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
          Object.values(legacyAgent));
      }
      if (version < 14) old.exec('DROP TABLE chat_reply_variants');
      if (version < 13) old.exec('DROP TABLE chat_activity; ALTER TABLE chats DROP COLUMN custom_title');
      if (version < 12) old.exec('DROP TABLE subagent_settings');
      if (version < 10) old.exec('DROP TABLE tool_presets');
      if (version === 10) old.exec('DROP INDEX active_tool_preset; ALTER TABLE tool_presets DROP COLUMN active');
      if (version >= 10) old.run(`INSERT INTO tool_presets (id, user_id, name, tools_json) VALUES ('old-tools', 1, 'Кубики', ?)`,
        [JSON.stringify(['roll_dice', legacyTool])]);
      if (version < 8) old.exec('DROP TABLE realms');
      else {
        if (version < 9) old.exec('ALTER TABLE realms DROP COLUMN favorite; ALTER TABLE realms DROP COLUMN author_key; ALTER TABLE realms DROP COLUMN tag_keys_json');
        old.run(`INSERT INTO realms (id, user_id, document_id, title, title_key, excerpt, search_text, created_at, updated_at, revision, document_json)
          VALUES ('old-realm', 1, 'island', 'Остров', 'остров', '', '', 10, 20, 1, ?)`, [JSON.stringify({
          specVersion: '0.1.0', id: 'island', title: 'Остров', base: 'Море', author: ' Лина ', tags: ['Туман', 'туман', 'Море'],
        })]);
        if (version >= 9) old.run('UPDATE realms SET author_key = ?, tag_keys_json = ? WHERE id = ?', ['лина', '["туман","море"]', 'old-realm']);
        if (version >= 19) old.exec("UPDATE agents SET world_id = 'old-realm' WHERE id = 'old-agent'");
      }
      if (version < 7) old.exec('DROP TABLE chat_private_turns; ALTER TABLE chats DROP COLUMN gm_mode');
      if (version < 6) old.exec('DROP TABLE enabled_tools');
      else old.run("INSERT INTO enabled_tools (user_id, tool_id) VALUES (1, 'roll_dice'), (1, ?)", [legacyTool]);
      if (version < 5) old.exec('DROP TABLE chats');
      else old.run("INSERT INTO chats (id, user_id, title, updated_at, revision, messages_json) VALUES ('old-chat', 1, 'Prior conversation', 1, 1, '[]')");
      if (version < 4) old.exec('DROP TABLE connection_presets; DROP TABLE provider_keys');
      if (version === 1) {
        old.exec('DROP TABLE chat_settings; PRAGMA user_version = 1');
      } else {
        old.run('INSERT INTO chat_settings (user_id, settings_json) VALUES (1, ?)', ['{"fontSize":20}']);
        old.exec(`PRAGMA user_version = ${version}`);
      }
    } finally {
      old.close();
    }

    const migrated = openDatabase(path, vaultKey);
    try {
      expect(migrated.query('PRAGMA user_version').get()).toEqual({ user_version: 21 });
      expect(migrated.query('SELECT * FROM instruction_presets').all()).toEqual(version < 17 ? [] : [
        { id: 'old-instruction', user_id: 1, name: 'Стиль', text: '{{ literal }}', active: 1, world_id: null, revision: 0 },
      ]);
      expect(migrated.query('SELECT * FROM agents').all()).toEqual(version < 15 ? [] : [
        { ...legacyAgent, world_id: version >= 19 ? 'old-realm' : null, revision: version === 20 ? 1 : 0 },
      ]);
      expect(migrated.query('SELECT * FROM temporary_agent_tools').all()).toEqual([]);
      expect(migrated.query('SELECT * FROM chat_reply_variants').all()).toEqual([]);
      expect(migrated.query('SELECT * FROM subagent_settings').all()).toEqual([]);
      expect(migrated.query('SELECT username FROM users').all()).toEqual([{ username: 'Лина' }]);
      expect(migrated.query('SELECT settings_json FROM chat_settings').all()).toEqual(version === 1 ? [] : [{ settings_json: '{"fontSize":20}' }]);
      expect(migrated.query('SELECT * FROM connection_presets').all()).toEqual([]);
      expect(migrated.query('SELECT id, gm_mode FROM chats').all()).toEqual(version >= 5 ? [{ id: 'old-chat', gm_mode: 0 }] : []);
      expect(migrated.query('SELECT * FROM chat_private_turns').all()).toEqual([]);
      expect(migrated.query('SELECT * FROM chat_activity').all()).toEqual([]);
      expect(migrated.query('SELECT * FROM enabled_tools ORDER BY tool_id').all()).toEqual(version < 6 ? [] : [
        { user_id: 1, tool_id: 'roll_dice' }, { user_id: 1, tool_id: 'subagent' },
      ]);
      expect(migrated.query('SELECT * FROM tool_presets').all()).toEqual(version < 10 ? [] : [
        { id: 'old-tools', user_id: 1, name: 'Кубики', tools_json: '["roll_dice","subagent"]', active: 0 },
      ]);
      expect(migrated.query('SELECT id, author_key, tag_keys_json, favorite, updated_at, revision FROM realms').all()).toEqual(version < 8 ? [] : [
        { id: 'old-realm', author_key: 'лина', tag_keys_json: '["туман","море"]', favorite: 0, updated_at: 20, revision: 1 },
      ]);
      if (version === 19) {
        migrated.exec("DELETE FROM realms WHERE id = 'old-realm'");
        expect(migrated.query("SELECT world_id, revision FROM agents WHERE id = 'old-agent'").get()).toEqual({ world_id: null, revision: 1 });
      }
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
        DROP TABLE instruction_presets;
        DROP TABLE temporary_agent_tools;
        DROP TABLE agents;
        DROP TABLE chat_reply_variants;
        DROP TABLE chat_activity;
        DROP TABLE subagent_settings;
        DROP TABLE tool_presets;
        DROP TABLE realms;
        DROP TABLE chat_private_turns;
        DROP TABLE enabled_tools;
        DROP TABLE chats;
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
