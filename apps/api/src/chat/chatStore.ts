import type { ChatMessage, ChatSnapshot, ChatSummary, SavedChat } from '@kuroko/contracts/chat';
import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

type Row = ChatSummary & { revision: number; messagesJson: string };

export function createChatStore(db: Database) {
  const list = db.query<ChatSummary, [number]>(`
    SELECT id, title, updated_at AS updatedAt FROM chats WHERE user_id = ? ORDER BY updated_at DESC, id
  `);
  const find = db.query<Row, [number, string]>(`
    SELECT id, title, updated_at AS updatedAt, revision, messages_json AS messagesJson FROM chats WHERE user_id = ? AND id = ?
  `);
  const insert = db.query(`
    INSERT INTO chats (id, user_id, title, updated_at, revision, messages_json) VALUES (?, ?, '', ?, 0, '[]')
  `);
  const update = db.query(`
    UPDATE chats SET title = ?, updated_at = ?, revision = revision + 1, messages_json = ? WHERE user_id = ? AND id = ?
  `);

  const save = db.transaction((userId: number, id: string, { revision, messages }: ChatSnapshot) => {
    const row = find.get(userId, id);
    if (!row) return 'missing';
    const messagesJson = JSON.stringify(messages);
    if (row.revision === revision + 1 && row.messagesJson === messagesJson) return readChat(row);
    if (row.revision !== revision) return 'conflict';
    const firstPrompt = messages.find(({ role }) => role === 'user')?.text ?? '';
    const title = Array.from(firstPrompt.replace(/\s+/g, ' ').trim()).slice(0, 64).join('');
    const updatedAt = Date.now();
    update.run(title, updatedAt, messagesJson, userId, id);
    return { id, title, updatedAt, revision: revision + 1, messages };
  });

  return {
    list: (userId: number) => list.all(userId),
    find(userId: number, id: string) {
      const row = find.get(userId, id);
      return row && readChat(row);
    },
    create(userId: number): SavedChat {
      const id = randomUUID();
      const updatedAt = Date.now();
      insert.run(id, userId, updatedAt);
      return { id, title: '', updatedAt, revision: 0, messages: [] };
    },
    save: save.immediate,
  };
}

function readChat({ messagesJson, ...row }: Row): SavedChat {
  return { ...row, messages: JSON.parse(messagesJson) as ChatMessage[] };
}
