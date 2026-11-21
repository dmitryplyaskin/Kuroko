import { CodedError } from '@kuroko/contracts/errors';
import type { Database } from 'bun:sqlite';
import { readChatSettings, type ChatSettings } from '@kuroko/contracts/chatSettings';

export function createChatSettingsStore(db: Database) {
  const find = db.query<{ settings_json: string }, [number]>('SELECT settings_json FROM chat_settings WHERE user_id = ?');
  const save = db.query<unknown, [number, string]>(`
    INSERT INTO chat_settings (user_id, settings_json) VALUES (?, ?)
    ON CONFLICT (user_id) DO UPDATE SET settings_json = excluded.settings_json
  `);

  return {
    read(userId: number) {
      const stored = find.get(userId);
      const settings = stored ? readChatSettings(JSON.parse(stored.settings_json)) : null;
      if (settings === undefined) throw new CodedError('database_chat_settings_invalid');
      return settings;
    },
    save: (userId: number, settings: ChatSettings) => save.run(userId, JSON.stringify(settings)),
  };
}
