import { CodedError } from '@kuroko/contracts/errors';
import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { realmFilterKey, realmTagKeys } from '../realms/realmFilterKeys';

const latestVersion = 24;

const initialSchema = `
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

const chatsSchema = `
  CREATE TABLE chats (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    messages_json TEXT NOT NULL CHECK (json_valid(messages_json))
  ) STRICT;

  CREATE INDEX chats_owner ON chats (user_id, updated_at DESC, id);
`;

const toolsSchema = `
  CREATE TABLE enabled_tools (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tool_id TEXT NOT NULL,
    PRIMARY KEY (user_id, tool_id)
  ) STRICT;
`;

const toolPresetsSchema = `
  CREATE TABLE tool_presets (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    tools_json TEXT NOT NULL CHECK (json_valid(tools_json) AND json_type(tools_json) = 'array'),
    UNIQUE (user_id, name)
  ) STRICT;
`;

const gmSchema = `
  ALTER TABLE chats ADD COLUMN gm_mode INTEGER NOT NULL DEFAULT 0 CHECK (gm_mode IN (0, 1));

  CREATE TABLE chat_private_turns (
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    reply_id INTEGER NOT NULL,
    prompt_id INTEGER NOT NULL,
    turn_json TEXT NOT NULL CHECK (json_valid(turn_json)),
    PRIMARY KEY (chat_id, reply_id)
  ) STRICT;
`;

const realmsSchema = `
  CREATE TABLE realms (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    title TEXT NOT NULL,
    title_key TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    search_text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    document_json TEXT NOT NULL CHECK (json_valid(document_json)),
    UNIQUE (user_id, document_id)
  ) STRICT;

  CREATE INDEX realms_owner_updated ON realms (user_id, updated_at DESC, id);
  CREATE INDEX realms_owner_created ON realms (user_id, created_at DESC, id);
  CREATE INDEX realms_owner_title ON realms (user_id, title_key, id);
`;

function migrateRealmFilters(db: Database) {
  db.exec(`
    ALTER TABLE realms ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1));
    ALTER TABLE realms ADD COLUMN author_key TEXT NOT NULL DEFAULT '';
    ALTER TABLE realms ADD COLUMN tag_keys_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tag_keys_json));
  `);
  const rows = db.query<{ id: string; author: string | null; tagsJson: string | null }, []>(`
    SELECT id, json_extract(document_json, '$.author') AS author, json_extract(document_json, '$.tags') AS tagsJson FROM realms
  `).all();
  const update = db.query('UPDATE realms SET author_key = ?, tag_keys_json = ? WHERE id = ?');
  for (const { id, author, tagsJson } of rows) {
    update.run(realmFilterKey(author ?? ''), realmTagKeys(tagsJson ? JSON.parse(tagsJson) as string[] : []), id);
  }
}

export function migrateDatabase(db: Database, vaultKey: Buffer) {
  const fingerprint = createHash('sha256').update(vaultKey).digest('hex');

  db.transaction(() => {
    const version = db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version;
    if (version === undefined || version < 0 || version > latestVersion) {
      throw new CodedError('database_schema_unsupported', { version });
    }

    if (version < 1) {
      db.exec(initialSchema);
      db.run('INSERT INTO vault_settings (id, key_fingerprint) VALUES (1, ?)', [fingerprint]);
    }

    const stored = db.query<{ key_fingerprint: string }, []>(
      'SELECT key_fingerprint FROM vault_settings WHERE id = 1',
    ).get();
    if (stored?.key_fingerprint !== fingerprint) {
      throw new CodedError('database_vault_key_mismatch');
    }

    if (version < 2) db.exec(chatSettingsSchema);
    // Version 3 was the only release with the old connection_settings table.
    if (version < 4) {
      db.exec(connectionPresetsSchema);
      if (version === 3) db.exec(migrateConnections);
    }
    if (version < 5) db.exec(chatsSchema);
    if (version < 6) db.exec(toolsSchema);
    if (version < 7) db.exec(gmSchema);
    if (version < 8) db.exec(realmsSchema);
    if (version < 9) migrateRealmFilters(db);
    if (version < 10) db.exec(toolPresetsSchema);
    if (version < 11) db.exec(`
      ALTER TABLE tool_presets ADD COLUMN active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1));
      CREATE UNIQUE INDEX active_tool_preset ON tool_presets (user_id) WHERE active = 1;
    `);
    if (version < 12) db.exec(`
      CREATE TABLE subagent_settings (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        preset_id TEXT NOT NULL REFERENCES connection_presets(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX subagent_settings_preset ON subagent_settings (preset_id);
    `);
    if (version < 13) db.exec(`
      ALTER TABLE chats ADD COLUMN custom_title TEXT;
      CREATE TABLE chat_activity (
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        prompt_id INTEGER NOT NULL,
        entries_json TEXT NOT NULL CHECK (json_valid(entries_json)),
        PRIMARY KEY (chat_id, prompt_id)
      ) STRICT;
    `);
    if (version < 14) db.exec(`
      CREATE TABLE chat_reply_variants (
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        reply_id INTEGER NOT NULL,
        selected_index INTEGER NOT NULL CHECK (selected_index >= 0 AND selected_index <= json_array_length(archived_json)),
        archived_json TEXT NOT NULL CHECK (json_type(archived_json) = 'array' AND json_array_length(archived_json) > 0),
        PRIMARY KEY (chat_id, reply_id)
      ) STRICT;
    `);

    if (version < 15) db.exec(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        description TEXT NOT NULL,
        instructions TEXT NOT NULL,
        tools_json TEXT NOT NULL CHECK (json_type(tools_json) = 'array'),
        UNIQUE (user_id, name_key)
      ) STRICT;

      UPDATE OR IGNORE enabled_tools SET tool_id = 'subagent' WHERE tool_id = 'delegate_task';
      DELETE FROM enabled_tools WHERE tool_id = 'delegate_task';
      UPDATE tool_presets SET tools_json = (
        SELECT json_group_array(tool) FROM (
          SELECT DISTINCT CASE value WHEN 'delegate_task' THEN 'subagent' ELSE value END AS tool
          FROM json_each(tool_presets.tools_json)
        )
      ) WHERE EXISTS (SELECT 1 FROM json_each(tools_json) WHERE value = 'delegate_task');
    `);

    if (version < 16) db.exec(`
      CREATE TABLE agents_v16 (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        description TEXT NOT NULL,
        instructions TEXT NOT NULL,
        tools_json TEXT NOT NULL CHECK (json_type(tools_json) = 'array')
      ) STRICT;
      INSERT INTO agents_v16 (id, user_id, name, name_key, description, instructions, tools_json)
        SELECT id, user_id, name, name_key, description, instructions, tools_json FROM agents;
      DROP TABLE agents;
      ALTER TABLE agents_v16 RENAME TO agents;
      CREATE INDEX agents_owner_name ON agents (user_id, name_key, id);

      CREATE TABLE temporary_agent_tools (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        tools_json TEXT NOT NULL CHECK (json_type(tools_json) = 'array')
      ) STRICT;
    `);

    if (version < 17) db.exec(`
      CREATE TABLE instruction_presets (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        text TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
        UNIQUE (user_id, name)
      ) STRICT;
      CREATE UNIQUE INDEX active_instruction_preset ON instruction_presets (user_id) WHERE active = 1;
    `);

    if (version < 18) db.exec(`
      ALTER TABLE instruction_presets ADD COLUMN template INTEGER NOT NULL DEFAULT 0 CHECK (template IN (0, 1));
      ALTER TABLE agents ADD COLUMN template INTEGER NOT NULL DEFAULT 0 CHECK (template IN (0, 1));
    `);

    if (version < 19) db.exec(`
      ALTER TABLE instruction_presets DROP COLUMN template;
      ALTER TABLE instruction_presets ADD COLUMN world_id TEXT REFERENCES realms(id) ON DELETE SET NULL;
      ALTER TABLE agents DROP COLUMN template;
      ALTER TABLE agents ADD COLUMN world_id TEXT REFERENCES realms(id) ON DELETE SET NULL;
    `);

    if (version < 20) db.exec(`
      ALTER TABLE agents ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);
      CREATE TRIGGER agents_world_revision AFTER UPDATE OF world_id ON agents
      WHEN OLD.world_id IS NOT NEW.world_id AND NEW.revision = OLD.revision
      BEGIN
        UPDATE agents SET revision = revision + 1 WHERE id = NEW.id;
      END;
    `);

    if (version < 21) db.exec(`
      ALTER TABLE connection_presets ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);
      ALTER TABLE instruction_presets ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);

      CREATE TRIGGER connection_presets_key_revision AFTER UPDATE OF key_id ON connection_presets
      WHEN OLD.key_id IS NOT NEW.key_id AND NEW.revision = OLD.revision
      BEGIN
        UPDATE connection_presets SET revision = revision + 1 WHERE id = NEW.id;
      END;

      CREATE TRIGGER instruction_presets_world_revision AFTER UPDATE OF world_id ON instruction_presets
      WHEN OLD.world_id IS NOT NEW.world_id AND NEW.revision = OLD.revision
      BEGIN
        UPDATE instruction_presets SET revision = revision + 1 WHERE id = NEW.id;
      END;
    `);

    if (version < 22) db.exec(`
      CREATE TABLE personas (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        description TEXT NOT NULL,
        description_key TEXT NOT NULL,
        avatar TEXT,
        variables_json TEXT NOT NULL CHECK (json_type(variables_json) = 'array'),
        variable_count INTEGER GENERATED ALWAYS AS (json_array_length(variables_json)) STORED,
        favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
        PRIMARY KEY (user_id, id)
      ) STRICT;
      CREATE INDEX personas_owner_updated ON personas (user_id, updated_at DESC, id);
      CREATE INDEX personas_owner_created ON personas (user_id, created_at DESC, id);
      CREATE INDEX personas_owner_name ON personas (user_id, name_key, id);
    `);

    if (version < 23 && !db.query("SELECT 1 FROM pragma_table_xinfo('personas') WHERE name = 'variable_count'").get()) {
      // Early version 22 databases need a column that can be added to existing rows.
      db.exec(`ALTER TABLE personas ADD COLUMN variable_count INTEGER
        GENERATED ALWAYS AS (json_array_length(variables_json)) VIRTUAL`);
    }

    if (version < 24) db.exec(`
      CREATE TABLE active_personas (
        user_id INTEGER PRIMARY KEY,
        persona_id TEXT NOT NULL,
        FOREIGN KEY (user_id, persona_id) REFERENCES personas(user_id, id) ON DELETE CASCADE
      ) STRICT;
    `);

    if (version < latestVersion) db.exec(`PRAGMA user_version = ${latestVersion}`);
  }).immediate();
}
