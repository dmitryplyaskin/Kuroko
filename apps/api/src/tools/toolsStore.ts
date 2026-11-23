import { isAgentToolId, isToolId, type AgentToolId, type ToolId, type ToolPreset, type ToolsResponse } from '@kuroko/contracts/tools';
import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import type { PresetWriteResult } from '../http/presetRouter';

type PresetRow = Pick<ToolPreset, 'id' | 'name'> & { tools_json: string; active: number };

function readPreset({ id, name, tools_json }: PresetRow): ToolPreset {
  return { id, name, enabled: (JSON.parse(tools_json) as unknown[]).filter(isToolId) };
}

export function createToolsStore(db: Database) {
  const list = db.query<{ tool_id: string }, [number]>('SELECT tool_id FROM enabled_tools WHERE user_id = ? ORDER BY tool_id');
  const enable = db.query<unknown, [number, ToolId]>('INSERT OR IGNORE INTO enabled_tools (user_id, tool_id) VALUES (?, ?)');
  const disable = db.query<unknown, [number, ToolId]>('DELETE FROM enabled_tools WHERE user_id = ? AND tool_id = ?');
  const clear = db.query('DELETE FROM enabled_tools WHERE user_id = ?');
  const listPresets = db.query<PresetRow, [number]>('SELECT id, name, tools_json, active FROM tool_presets WHERE user_id = ? ORDER BY name, id');
  const findPreset = db.query<PresetRow, [number, string]>('SELECT id, name, tools_json, active FROM tool_presets WHERE user_id = ? AND id = ?');
  const insertPreset = db.query(`
    INSERT INTO tool_presets (id, user_id, name, tools_json) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, name) DO NOTHING
  `);
  const removePreset = db.query('DELETE FROM tool_presets WHERE user_id = ? AND id = ?');
  const updatePreset = db.query('UPDATE tool_presets SET tools_json = ? WHERE user_id = ? AND id = ?');
  const rename = db.query('UPDATE OR IGNORE tool_presets SET name = ? WHERE user_id = ? AND id = ?');
  const deactivate = db.query('UPDATE tool_presets SET active = 0 WHERE user_id = ? AND active = 1');
  const activate = db.query('UPDATE tool_presets SET active = 1 WHERE user_id = ? AND id = ?');
  const findSubagent = db.query<{ preset_id: string }, [number]>('SELECT preset_id FROM subagent_settings WHERE user_id = ?');
  const setSubagent = db.query(`
    INSERT INTO subagent_settings (user_id, preset_id)
      SELECT user_id, id FROM connection_presets WHERE user_id = ? AND id = ?
      ON CONFLICT (user_id) DO UPDATE SET preset_id = excluded.preset_id
  `);
  const clearSubagent = db.query('DELETE FROM subagent_settings WHERE user_id = ?');
  const findTemporaryTools = db.query<{ tools_json: string }, [number]>('SELECT tools_json FROM temporary_agent_tools WHERE user_id = ?');
  const setTemporaryTools = db.query(`
    INSERT INTO temporary_agent_tools (user_id, tools_json) VALUES (?, ?)
    ON CONFLICT (user_id) DO UPDATE SET tools_json = excluded.tools_json
  `);
  const clearTemporaryTools = db.query('DELETE FROM temporary_agent_tools WHERE user_id = ?');

  const enabledTools = (userId: number) => list.all(userId).map(({ tool_id }) => tool_id).filter(isToolId);
  function readTemporaryTools(userId: number) {
    const row = findTemporaryTools.get(userId);
    return row ? (JSON.parse(row.tools_json) as unknown[]).filter(isAgentToolId) : undefined;
  }
  const read = db.transaction((userId: number): ToolsResponse => {
    const enabled = enabledTools(userId);
    const rows = listPresets.all(userId);
    const activePresetId = rows.find((row) => row.active)?.id;
    const temporaryAgentTools = readTemporaryTools(userId);
    return {
      enabled, ...(rows.length ? { presets: rows.map(readPreset) } : {}), ...(activePresetId ? { activePresetId } : {}),
      ...(temporaryAgentTools && { temporaryAgentTools }),
    };
  });
  function applyTools(userId: number, id: string, enabled: ToolId[]) {
    deactivate.run(userId);
    activate.run(userId, id);
    clear.run(userId);
    for (const toolId of enabled) enable.run(userId, toolId);
  }

  const createPreset = db.transaction((userId: number, name: string, enabled: ToolId[], apply: boolean): PresetWriteResult => {
    const id = randomUUID();
    if (!insertPreset.run(id, userId, name, JSON.stringify(enabled)).changes) return 'duplicate';
    if (apply) applyTools(userId, id, enabled);
    return 'saved';
  });
  const savePreset = db.transaction((userId: number, id: string, enabled: ToolId[]): PresetWriteResult => {
    if (!updatePreset.run(JSON.stringify(enabled), userId, id).changes) return 'missing-preset';
    applyTools(userId, id, enabled);
    return 'saved';
  });
  const applyPreset = db.transaction((userId: number, id: string) => {
    const row = findPreset.get(userId, id);
    if (!row) return false;
    applyTools(userId, id, readPreset(row).enabled);
    return true;
  });
  const renamePreset = db.transaction((userId: number, id: string, name: string): PresetWriteResult => {
    if (!findPreset.get(userId, id)) return 'missing-preset';
    return rename.run(name, userId, id).changes ? 'saved' : 'duplicate';
  });
  const copyPreset = db.transaction((userId: number, id: string, name: string): PresetWriteResult => {
    const source = findPreset.get(userId, id);
    if (!source) return 'missing-preset';
    return insertPreset.run(randomUUID(), userId, name, source.tools_json).changes ? 'saved' : 'duplicate';
  });

  return {
    list: enabledTools,
    temporaryAgentTools: (userId: number, enabled = enabledTools(userId)) => readTemporaryTools(userId) ?? enabled.filter(isAgentToolId),
    setTemporaryAgentTools(userId: number, tools: AgentToolId[] | null) {
      if (tools === null) clearTemporaryTools.run(userId);
      else setTemporaryTools.run(userId, JSON.stringify(tools));
    },
    subagentPresetId: (userId: number) => findSubagent.get(userId)?.preset_id ?? null,
    selectSubagent(userId: number, presetId: string | null) {
      if (presetId !== null) return setSubagent.run(userId, presetId).changes > 0;
      clearSubagent.run(userId);
      return true;
    },
    read: read.deferred,
    set(userId: number, id: ToolId, enabled: boolean) {
      (enabled ? enable : disable).run(userId, id);
    },
    clear: (userId: number) => clear.run(userId),
    createPreset: createPreset.immediate,
    savePreset: savePreset.immediate,
    applyPreset: applyPreset.immediate,
    renamePreset: renamePreset.immediate,
    copyPreset: copyPreset.immediate,
    removePreset: (userId: number, id: string) => removePreset.run(userId, id).changes > 0,
  };
}
