import type { InstructionDraft, InstructionPreset, InstructionSettings } from '@kuroko/contracts/instructions';
import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import type { PresetWriteResult } from '../http/presetRouter';

type DraftRow = { text: string; worldId: string | null };
type PresetRow = DraftRow & Pick<InstructionPreset, 'id' | 'name'> & { active: number; worldTitle: string | null };

function readDraft({ text, worldId }: DraftRow): InstructionDraft {
  return { text, ...(worldId ? { worldId } : {}) };
}

export function createInstructionStore(db: Database) {
  const list = db.query<PresetRow, [number]>(`
    SELECT id, name, text, world_id AS worldId, active,
      (SELECT title FROM realms WHERE realms.id = instruction_presets.world_id) AS worldTitle
    FROM instruction_presets WHERE user_id = ? ORDER BY name, id
  `);
  const find = db.query<DraftRow, [number, string]>('SELECT text, world_id AS worldId FROM instruction_presets WHERE user_id = ? AND id = ?');
  const findActive = db.query<DraftRow, [number]>('SELECT text, world_id AS worldId FROM instruction_presets WHERE user_id = ? AND active = 1');
  const insert = db.query(`
    INSERT INTO instruction_presets (id, user_id, name, text, world_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, name) DO NOTHING
  `);
  const update = db.query('UPDATE instruction_presets SET text = ?, world_id = ? WHERE user_id = ? AND id = ?');
  const rename = db.query('UPDATE OR IGNORE instruction_presets SET name = ? WHERE user_id = ? AND id = ?');
  const remove = db.query('DELETE FROM instruction_presets WHERE user_id = ? AND id = ?');
  const deactivate = db.query('UPDATE instruction_presets SET active = 0 WHERE user_id = ? AND active = 1');
  const activate = db.query('UPDATE instruction_presets SET active = 1 WHERE user_id = ? AND id = ?');

  function select(userId: number, id: string) {
    deactivate.run(userId);
    activate.run(userId, id);
  }

  const createPreset = db.transaction((userId: number, name: string, draft: InstructionDraft): PresetWriteResult => {
    const id = randomUUID();
    if (!insert.run(id, userId, name, draft.text, draft.worldId ?? null).changes) return 'duplicate';
    select(userId, id);
    return 'saved';
  });
  const applyPreset = db.transaction((userId: number, id: string) => {
    if (!find.get(userId, id)) return false;
    select(userId, id);
    return true;
  });
  const renamePreset = db.transaction((userId: number, id: string, name: string): PresetWriteResult => {
    if (!find.get(userId, id)) return 'missing-preset';
    return rename.run(name, userId, id).changes ? 'saved' : 'duplicate';
  });
  const copyPreset = db.transaction((userId: number, id: string, name: string): PresetWriteResult => {
    const source = find.get(userId, id);
    if (!source) return 'missing-preset';
    return insert.run(randomUUID(), userId, name, source.text, source.worldId).changes ? 'saved' : 'duplicate';
  });

  return {
    read(userId: number): InstructionSettings {
      const rows = list.all(userId);
      return {
        activePresetId: rows.find(({ active }) => active)?.id ?? null,
        presets: rows.map(({ id, name, worldTitle, ...draft }) => ({ id, name, ...readDraft(draft), ...(worldTitle ? { worldTitle } : {}) })),
      };
    },
    active(userId: number) {
      const row = findActive.get(userId);
      return row && readDraft(row);
    },
    clearActive: (userId: number) => deactivate.run(userId),
    createPreset: createPreset.immediate,
    applyPreset: applyPreset.immediate,
    renamePreset: renamePreset.immediate,
    copyPreset: copyPreset.immediate,
    savePreset: (userId: number, id: string, draft: InstructionDraft): PresetWriteResult =>
      update.run(draft.text, draft.worldId ?? null, userId, id).changes ? 'saved' : 'missing-preset',
    removePreset: (userId: number, id: string) => remove.run(userId, id).changes > 0,
  };
}
