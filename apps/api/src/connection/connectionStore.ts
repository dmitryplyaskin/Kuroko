import { CodedError } from '@kuroko/contracts/errors';
import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import {
  isProvider, readConnectionSettings, type ConnectionPreset, type ConnectionState, type SaveConnectionPreset,
} from '@kuroko/contracts/connectionSettings';
import type { ProviderKeyStore } from './providerKeyStore';

type Row = { id: string; name: string; provider: string; settings_json: string; key_id: string | null; active: number };

export function createConnectionStore(db: Database, keys: ProviderKeyStore) {
  const list = db.query<Row, [number]>(`
    SELECT id, name, provider, settings_json, key_id, active FROM connection_presets WHERE user_id = ? ORDER BY name, id
  `);
  const find = db.query<Row, [number, string]>(`
    SELECT id, name, provider, settings_json, key_id, active FROM connection_presets WHERE user_id = ? AND id = ?
  `);
  const findActive = db.query<Row, [number]>(`
    SELECT id, name, provider, settings_json, key_id, active FROM connection_presets WHERE user_id = ? AND active = 1
  `);
  const findByName = db.query<{ id: string }, [number, string]>('SELECT id FROM connection_presets WHERE user_id = ? AND name = ?');
  const deactivate = db.query('UPDATE connection_presets SET active = 0 WHERE user_id = ? AND active = 1');
  const insert = db.query(`
    INSERT INTO connection_presets (id, user_id, name, provider, settings_json, key_id, active) VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  const update = db.query(`
    UPDATE connection_presets SET name = ?, provider = ?, settings_json = ?, key_id = ?, active = 1 WHERE user_id = ? AND id = ?
  `);
  const remove = db.query('DELETE FROM connection_presets WHERE user_id = ? AND id = ?');

  function read(userId: number): ConnectionState {
    const rows = list.all(userId);
    return {
      activePresetId: rows.find((row) => row.active)?.id ?? null,
      presets: rows.map(readPreset),
      keys: keys.list(userId),
    };
  }

  const save = db.transaction((userId: number, id: string | null, { name, provider, settings, keyId }: SaveConnectionPreset) => {
    if (id && !find.get(userId, id)) return 'missing-preset';
    const named = findByName.get(userId, name);
    if (named && named.id !== id) return 'duplicate';
    if (keyId && !keys.has(userId, provider, keyId)) return 'missing-key';

    deactivate.run(userId);
    const json = JSON.stringify(settings);
    if (id) update.run(name, provider, json, keyId, userId, id);
    else insert.run(randomUUID(), userId, name, provider, json, keyId);
    return 'saved';
  });

  return {
    read,
    find(userId: number, id?: string) {
      const row = id === undefined ? findActive.get(userId) : find.get(userId, id);
      return row ? readPreset(row) : null;
    },
    save: save.immediate,
    remove: (userId: number, id: string) => remove.run(userId, id).changes !== 0,
  };
}

function readPreset({ id, name, provider, settings_json, key_id }: Row): ConnectionPreset {
  if (!isProvider(provider)) throw new CodedError('database_provider_invalid');
  const settings = readConnectionSettings(provider, JSON.parse(settings_json));
  if (!settings) throw new CodedError('database_preset_invalid');
  return { ...settings, id, name, provider, keyId: key_id };
}
