import { chatTitleLimit, type ChatActivityEntry, type ChatMessage, type ChatSnapshot, type ChatSummary, type ChatToolCall, type SavedChat } from '@kuroko/contracts/chat';
import type { LlmAssistantMessage } from '@kuroko/contracts/llm';
import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

type Row = ChatSummary & { revision: number; messagesJson: string; gmMode: 0 | 1; customTitle: string | null };
export type PrivateTurn = {
  notes?: string;
  rounds: { assistant: LlmAssistantMessage; calls: ChatToolCall[] }[];
};

export function createChatStore(db: Database) {
  const list = db.query<ChatSummary, [number]>(`
    SELECT id, coalesce(custom_title, title) AS title, updated_at AS updatedAt FROM chats WHERE user_id = ? ORDER BY updated_at DESC, id
  `);
  const find = db.query<Row, [number, string]>(`
    SELECT id, title, updated_at AS updatedAt, revision, messages_json AS messagesJson, gm_mode AS gmMode, custom_title AS customTitle
    FROM chats WHERE user_id = ? AND id = ?
  `);
  const insert = db.query(`
    INSERT INTO chats (id, user_id, title, updated_at, revision, messages_json) VALUES (?, ?, '', ?, 0, '[]')
  `);
  const update = db.query(`
    UPDATE chats SET title = ?, updated_at = ?, revision = revision + 1, messages_json = ?, gm_mode = ?
    WHERE user_id = ? AND id = ?
  `);
  const listPrivate = db.query<{ replyId: number; turnJson: string }, [number, string]>(`
    SELECT turn.reply_id AS replyId, turn.turn_json AS turnJson
    FROM chat_private_turns AS turn JOIN chats AS chat ON chat.id = turn.chat_id
    WHERE chat.user_id = ? AND chat.id = ? ORDER BY turn.reply_id
  `);
  const insertPrivate = db.query(`
    INSERT INTO chat_private_turns (chat_id, reply_id, prompt_id, turn_json) VALUES (?, ?, ?, ?)
  `);
  const deletePrivate = db.query(`
    DELETE FROM chat_private_turns WHERE chat_id = ? AND (reply_id = ? OR prompt_id = ?)
  `);
  const rename = db.query<ChatSummary, [string, number, string]>(`
    UPDATE chats SET custom_title = ? WHERE user_id = ? AND id = ?
    RETURNING id, custom_title AS title, updated_at AS updatedAt
  `);
  const remove = db.query('DELETE FROM chats WHERE user_id = ? AND id = ?');
  const listActivity = db.query<{ promptId: number; entriesJson: string }, [string]>(`
    SELECT prompt_id AS promptId, entries_json AS entriesJson FROM chat_activity WHERE chat_id = ? ORDER BY prompt_id
  `);
  const insertActivity = db.query(`
    INSERT INTO chat_activity (chat_id, prompt_id, entries_json) VALUES (?, ?, ?)
    ON CONFLICT (chat_id, prompt_id) DO UPDATE SET entries_json = excluded.entries_json
  `);
  const findActivity = db.query<{ entriesJson: string }, [string, number]>(`
    SELECT entries_json AS entriesJson FROM chat_activity WHERE chat_id = ? AND prompt_id = ?
  `);
  const deleteActivity = db.query('DELETE FROM chat_activity WHERE chat_id = ? AND prompt_id = ?');

  const save = db.transaction((userId: number, id: string, { revision, messages, gmMode, activity }: ChatSnapshot) => {
    const row = find.get(userId, id);
    if (!row) return 'missing';
    const messagesJson = JSON.stringify(messages);
    const mode = gmMode ?? Boolean(row.gmMode);
    const entriesJson = activity && JSON.stringify(activity.entries);
    if (row.revision === revision + 1 && row.messagesJson === messagesJson && mode === Boolean(row.gmMode) &&
        (!activity || findActivity.get(id, activity.promptId)?.entriesJson === entriesJson)) return readChat(row);
    if (row.revision !== revision) return 'conflict';
    const firstPrompt = messages.find(({ role }) => role === 'user')?.text ?? '';
    const title = Array.from(firstPrompt.replace(/\s+/g, ' ').trim()).slice(0, chatTitleLimit).join('');
    const updatedAt = Date.now();
    if (row.messagesJson !== messagesJson) {
      const current = new Map(messages.map((message) => [message.id, message]));
      for (const previous of readChat(row).messages) {
        const message = current.get(previous.id);
        if (message?.role !== previous.role || message.text !== previous.text) deletePrivate.run(id, previous.id, previous.id);
        if (message?.role !== previous.role) deleteActivity.run(id, previous.role === 'user' ? previous.id : previous.id - 1);
      }
    }
    update.run(title, updatedAt, messagesJson, Number(mode), userId, id);
    if (activity && entriesJson) insertActivity.run(id, activity.promptId, entriesJson);
    return { id, title: row.customTitle ?? title, updatedAt, revision: revision + 1, messages, gmMode: mode };
  });

  const publish = db.transaction((userId: number, id: string, revision: number, text: string, turn: PrivateTurn) => {
    const row = find.get(userId, id);
    if (!row) return 'missing';
    if (row.revision !== revision || !row.gmMode) return 'conflict';
    const chat = readChat(row);
    const prompt = chat.messages.at(-1);
    if (prompt?.role !== 'user' || prompt.id >= Number.MAX_SAFE_INTEGER - 2) return 'conflict';
    const reply: ChatMessage = { id: prompt.id + 1, role: 'assistant', text, time: Date.now() };
    chat.messages.push(reply);
    update.run(row.title, reply.time, JSON.stringify(chat.messages), row.gmMode, userId, id);
    insertPrivate.run(id, reply.id, prompt.id, JSON.stringify(turn));
    return { ...chat, revision: revision + 1, updatedAt: reply.time };
  });

  return {
    list: (userId: number) => list.all(userId),
    find(userId: number, id: string) {
      const row = find.get(userId, id);
      return row && readChat(row);
    },
    open: db.transaction((userId: number, id: string) => {
      const row = find.get(userId, id);
      if (!row) return;
      const activity = listActivity.all(id).map(({ promptId, entriesJson }) => ({
        promptId, entries: JSON.parse(entriesJson) as ChatActivityEntry[],
      }));
      return { ...readChat(row), ...(activity.length && { activity }) };
    }),
    rename: (userId: number, id: string, title: string) => rename.get(title, userId, id),
    remove: (userId: number, id: string) => remove.run(userId, id).changes > 0,
    create(userId: number): SavedChat {
      const id = randomUUID();
      const updatedAt = Date.now();
      insert.run(id, userId, updatedAt);
      return { id, title: '', updatedAt, revision: 0, messages: [], gmMode: false };
    },
    save: save.immediate,
    publish: publish.immediate,
    privateTurns: (userId: number, id: string) => listPrivate.all(userId, id)
      .map(({ replyId, turnJson }) => ({ replyId, turn: JSON.parse(turnJson) as PrivateTurn })),
  };
}

function readChat({ messagesJson, gmMode, customTitle, ...row }: Row): SavedChat {
  return { ...row, title: customTitle ?? row.title, gmMode: Boolean(gmMode), messages: JSON.parse(messagesJson) as ChatMessage[] };
}
