import { CodedError } from '@kuroko/contracts/errors';
import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import {
  isProvider, readConnectionSettings, type ConnectionPreset, type ConnectionState, type SaveConnectionPreset, type UpdateConnectionPreset,
} from '@kuroko/contracts/connectionSettings';
import type { ProviderKeyStore } from './providerKeyStore';
import type { PresetWriteResult } from '../http/presetRouter';

type Row = { id: string; name: string; provider: string; settings_json: string; key_id: string | null; active: number; revision: number };

type PresetWrite = (SaveConnectionPreset & { id?: never }) | (UpdateConnectionPreset & { id: string });

export function createConnectionStore(db: Database, keys: ProviderKeyStore) {
  const fields = 'id, name, provider, settings_json, key_id, active, revision';
  const list = db.query<Row, [number]>(`
    SELECT ${fields} FROM connection_presets WHERE user_id = ? ORDER BY name, id
  `);
  const find = db.query<Row, [number, string]>(`
    SELECT ${fields} FROM connection_presets WHERE user_id = ? AND id = ?
  `);
  const findActive = db.query<Row, [number]>(`
    SELECT ${fields} FROM connection_presets WHERE user_id = ? AND active = 1
  `);
  const findByName = db.query<{ id: string }, [number, string]>('SELECT id FROM connection_presets WHERE user_id = ? AND name = ?');
  const deactivate = db.query('UPDATE connection_presets SET active = 0 WHERE user_id = ? AND active = 1');
  const activate = db.query('UPDATE connection_presets SET active = 1 WHERE user_id = ? AND id = ?');
  const insert = db.query(`
    INSERT INTO connection_presets (id, user_id, name, provider, settings_json, key_id, active) VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  const update = db.query(`
    UPDATE connection_presets SET provider = ?, settings_json = ?, key_id = ?, active = 1, revision = revision + 1
    WHERE user_id = ? AND id = ?
  `);
  const remove = db.query('DELETE FROM connection_presets WHERE user_id = ? AND id = ?');
  const rename = db.query('UPDATE OR IGNORE connection_presets SET name = ? WHERE user_id = ? AND id = ?');
  const insertCopy = db.query(`
    INSERT INTO connection_presets (id, user_id, name, provider, settings_json, key_id, active)
    VALUES (?, ?, ?, ?, ?, ?, 0) ON CONFLICT (user_id, name) DO NOTHING
  `);

  function read(userId: number): ConnectionState {
    const rows = list.all(userId);
    return {
      activePresetId: rows.find((row) => row.active)?.id ?? null,
      presets: rows.map(readPreset),
      keys: keys.list(userId),
    };
  }

  const save = db.transaction((userId: number, input: PresetWrite) => {
    const { id, provider, settings, keyId } = input;
    const json = JSON.stringify(settings);
    if (id !== undefined) {
      const current = find.get(userId, id);
      if (!current) return 'missing-preset';
      if (input.revision !== current.revision) {
        const repeated = input.revision + 1 === current.revision && current.provider === provider &&
          current.settings_json === json && current.key_id === keyId;
        return repeated ? 'saved' : 'conflict';
      }
    } else if (findByName.get(userId, input.name)) return 'duplicate';
    if (keyId && !keys.has(userId, provider, keyId)) return 'missing-key';

    deactivate.run(userId);
    if (id !== undefined) update.run(provider, json, keyId, userId, id);
    else insert.run(randomUUID(), userId, input.name, provider, json, keyId);
    return 'saved';
  });
  const applyPreset = db.transaction((userId: number, id: string) => {
    if (!find.get(userId, id)) return false;
    deactivate.run(userId);
    activate.run(userId, id);
    return true;
  });
  const renamePreset = db.transaction((userId: number, id: string, name: string): PresetWriteResult => {
    if (!find.get(userId, id)) return 'missing-preset';
    return rename.run(name, userId, id).changes ? 'saved' : 'duplicate';
  });
  const copyPreset = db.transaction((userId: number, id: string, name: string): PresetWriteResult => {
    const source = find.get(userId, id);
    if (!source) return 'missing-preset';
    return insertCopy.run(randomUUID(), userId, name, source.provider, source.settings_json, source.key_id).changes
      ? 'saved' : 'duplicate';
  });

  return {
    read,
    listPresets: (userId: number) => list.all(userId).map(readPreset),
    find(userId: number, id?: string) {
      const row = id === undefined ? findActive.get(userId) : find.get(userId, id);
      return row ? readPreset(row) : null;
    },
    save: save.immediate,
    applyPreset: applyPreset.immediate,
    renamePreset: renamePreset.immediate,
    copyPreset: copyPreset.immediate,
    removePreset: (userId: number, id: string) => remove.run(userId, id).changes !== 0,
  };
}

function readPreset({ id, name, provider, settings_json, key_id, revision }: Row): ConnectionPreset {
  if (!isProvider(provider)) throw new CodedError('database_provider_invalid');
  const settings = readConnectionSettings(provider, JSON.parse(settings_json));
  if (!settings) throw new CodedError('database_preset_invalid');
  return { ...settings, id, name, revision, provider, keyId: key_id };
}
