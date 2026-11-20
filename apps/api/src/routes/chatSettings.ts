import type { Database } from 'bun:sqlite';
import { Router } from 'express';
import { readChatSettings, type ChatSettingsResponse } from '../../../shared/chatSettings';

export function createChatSettingsRouter(db: Database) {
  const router = Router();
  const find = db.query<{ settings_json: string }, [number]>('SELECT settings_json FROM chat_settings WHERE user_id = ?');
  const save = db.query<unknown, [number, string]>(`
    INSERT INTO chat_settings (user_id, settings_json) VALUES (?, ?)
    ON CONFLICT (user_id) DO UPDATE SET settings_json = excluded.settings_json
  `);

  router.get('/', (_request, response) => {
    const stored = find.get(response.locals.user.id);
    const settings = stored ? readChatSettings(JSON.parse(stored.settings_json)) : null;
    if (settings === undefined) throw new Error('Invalid chat settings in the database');
    response.json({ settings } satisfies ChatSettingsResponse);
  });

  router.put('/', (request, response) => {
    const settings = readChatSettings(request.body);
    if (!settings) {
      response.status(400).json({ error: 'Проверьте размер текста, ширину, расположение сообщений и цвета чата.' });
      return;
    }

    save.run(response.locals.user.id, JSON.stringify(settings));
    response.json({ settings } satisfies ChatSettingsResponse);
  });

  return router;
}
