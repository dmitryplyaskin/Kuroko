import type { Database } from 'bun:sqlite';
import { Router } from 'express';
import { errorBody } from '@kuroko/contracts/errors';
import { isToolId, type ToolId, type ToolsResponse } from '@kuroko/contracts/tools';

export function createToolsRouter(db: Database) {
  const list = db.query<{ tool_id: string }, [number]>('SELECT tool_id FROM enabled_tools WHERE user_id = ? ORDER BY tool_id');
  const enable = db.query<unknown, [number, ToolId]>('INSERT OR IGNORE INTO enabled_tools (user_id, tool_id) VALUES (?, ?)');
  const disable = db.query<unknown, [number, ToolId]>('DELETE FROM enabled_tools WHERE user_id = ? AND tool_id = ?');
  const read = (userId: number): ToolsResponse => ({ enabled: list.all(userId).map(({ tool_id }) => tool_id).filter(isToolId) });

  const router = Router();
  router.get('/', (_request, response) => { response.json(read(response.locals.user.id)); });
  router.put('/:id', (request, response) => {
    const { id } = request.params;
    const enabled: unknown = request.body?.enabled;
    if (!isToolId(id) || typeof enabled !== 'boolean') {
      response.status(400).json(errorBody('invalid_request'));
      return;
    }
    const userId: number = response.locals.user.id;
    (enabled ? enable : disable).run(userId, id);
    response.json(read(userId));
  });
  return router;
}
