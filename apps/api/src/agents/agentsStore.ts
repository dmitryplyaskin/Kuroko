import type { AgentDraft, AgentSummary, SavedAgent, UpdateAgent } from '@kuroko/contracts/agents';
import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

type AgentRow = Omit<SavedAgent, 'tools' | 'worldTitle'> & { tools_json: string; worldTitle: string | null };

function readAgent({ tools_json, worldId, worldTitle, ...agent }: AgentRow): SavedAgent {
  return { ...agent, tools: JSON.parse(tools_json) as AgentDraft['tools'], ...(worldId ? { worldId, worldTitle: worldTitle ?? undefined } : {}) };
}

export function createAgentsStore(db: Database) {
  const fields = `id, revision, name, description, instructions, tools_json, world_id AS worldId,
    (SELECT title FROM realms WHERE realms.id = agents.world_id) AS worldTitle`;
  const list = db.query<AgentRow, [number]>(`SELECT ${fields} FROM agents WHERE user_id = ? ORDER BY name_key, id`);
  const catalog = db.query<AgentSummary & Pick<AgentDraft, 'worldId'>, [number]>(
    'SELECT id, name, description, world_id AS worldId FROM agents WHERE user_id = ? ORDER BY name_key, id');
  const find = db.query<AgentRow, [number, string]>(`SELECT ${fields} FROM agents WHERE user_id = ? AND id = ?`);
  const insert = db.query<AgentRow, [string, number, string, string, string, string, string, string | null]>(`
    INSERT INTO agents (id, user_id, name, name_key, description, instructions, tools_json, world_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING ${fields}
  `);
  const update = db.query<AgentRow, [string, string, string, string, string, string | null, number, string]>(`
    UPDATE agents SET name = ?, name_key = ?, description = ?, instructions = ?, tools_json = ?, world_id = ?, revision = revision + 1
    WHERE user_id = ? AND id = ? RETURNING ${fields}
  `);
  const remove = db.query('DELETE FROM agents WHERE user_id = ? AND id = ?');
  const save = db.transaction((userId: number, id: string, draft: UpdateAgent) => {
    const current = find.get(userId, id);
    if (!current) return 'missing';
    const tools = JSON.stringify(draft.tools);
    const worldId = draft.worldId ?? null;
    const same = draft.name === current.name && draft.description === current.description &&
      draft.instructions === current.instructions && tools === current.tools_json && worldId === current.worldId;
    if (same && (draft.revision === current.revision || draft.revision + 1 === current.revision)) return readAgent(current);
    if (draft.revision !== current.revision) return 'conflict';
    return readAgent(update.get(draft.name, draft.name.toLowerCase(), draft.description, draft.instructions, tools, worldId, userId, id)!);
  });

  return {
    list: (userId: number) => list.all(userId).map(readAgent),
    catalog: (userId: number) => catalog.all(userId),
    find(userId: number, id: string) {
      const row = find.get(userId, id);
      return row ? readAgent(row) : undefined;
    },
    create(userId: number, draft: AgentDraft) {
      return readAgent(insert.get(randomUUID(), userId, draft.name, draft.name.toLowerCase(), draft.description, draft.instructions,
        JSON.stringify(draft.tools), draft.worldId ?? null)!);
    },
    save: save.immediate,
    remove: (userId: number, id: string) => remove.run(userId, id).changes > 0,
  };
}
