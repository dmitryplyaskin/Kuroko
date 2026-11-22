import { isToolId, type ToolId, type ToolPreset, type ToolsResponse } from '@kuroko/contracts/tools';
import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

type PresetRow = Pick<ToolPreset, 'id' | 'name'> & { tools_json: string };

function readPreset({ id, name, tools_json }: PresetRow): ToolPreset {
  return { id, name, enabled: (JSON.parse(tools_json) as unknown[]).filter(isToolId) };
}

export function createToolsStore(db: Database) {
  const list = db.query<{ tool_id: string }, [number]>('SELECT tool_id FROM enabled_tools WHERE user_id = ? ORDER BY tool_id');
  const enable = db.query<unknown, [number, ToolId]>('INSERT OR IGNORE INTO enabled_tools (user_id, tool_id) VALUES (?, ?)');
  const disable = db.query<unknown, [number, ToolId]>('DELETE FROM enabled_tools WHERE user_id = ? AND tool_id = ?');
  const clear = db.query('DELETE FROM enabled_tools WHERE user_id = ?');
  const listPresets = db.query<PresetRow, [number]>('SELECT id, name, tools_json FROM tool_presets WHERE user_id = ? ORDER BY name, id');
  const findPreset = db.query<PresetRow, [number, string]>('SELECT id, name, tools_json FROM tool_presets WHERE user_id = ? AND id = ?');
  const insertPreset = db.query(`
    INSERT INTO tool_presets (id, user_id, name, tools_json) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, name) DO NOTHING
  `);
  const removePreset = db.query('DELETE FROM tool_presets WHERE user_id = ? AND id = ?');

  const enabledTools = (userId: number) => list.all(userId).map(({ tool_id }) => tool_id).filter(isToolId);
  const read = db.transaction((userId: number): ToolsResponse => {
    const enabled = enabledTools(userId);
    const presets = listPresets.all(userId).map(readPreset);
    return { enabled, ...(presets.length ? { presets } : {}) };
  });
  const applyPreset = db.transaction((userId: number, id: string) => {
    const row = findPreset.get(userId, id);
    if (!row) return false;
    const { enabled } = readPreset(row);
    clear.run(userId);
    for (const toolId of enabled) enable.run(userId, toolId);
    return true;
  });

  return {
    list: enabledTools,
    read: read.deferred,
    set(userId: number, id: ToolId, enabled: boolean) {
      (enabled ? enable : disable).run(userId, id);
    },
    clear: (userId: number) => clear.run(userId),
    savePreset: (userId: number, name: string, enabled: ToolId[]) =>
      insertPreset.run(randomUUID(), userId, name, JSON.stringify(enabled)).changes > 0,
    applyPreset: applyPreset.immediate,
    removePreset: (userId: number, id: string) => removePreset.run(userId, id).changes > 0,
  };
}
