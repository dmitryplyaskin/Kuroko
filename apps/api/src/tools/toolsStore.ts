import { isToolId, type ToolId } from '@kuroko/contracts/tools';
import type { Database } from 'bun:sqlite';

export function createToolsStore(db: Database) {
  const list = db.query<{ tool_id: string }, [number]>('SELECT tool_id FROM enabled_tools WHERE user_id = ? ORDER BY tool_id');
  const enable = db.query<unknown, [number, ToolId]>('INSERT OR IGNORE INTO enabled_tools (user_id, tool_id) VALUES (?, ?)');
  const disable = db.query<unknown, [number, ToolId]>('DELETE FROM enabled_tools WHERE user_id = ? AND tool_id = ?');
  return {
    list: (userId: number) => list.all(userId).map(({ tool_id }) => tool_id).filter(isToolId),
    set(userId: number, id: ToolId, enabled: boolean) {
      (enabled ? enable : disable).run(userId, id);
    },
  };
}
