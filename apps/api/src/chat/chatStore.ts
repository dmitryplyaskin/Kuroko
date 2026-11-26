import {
  chatReplyPrompt, chatTitleLimit, type ChatActivityEntry, type ChatMessage, type ChatReplyVariantSelection,
  type ChatSnapshot, type ChatSummary, type ChatToolCall, type SavedChat,
} from '@kuroko/contracts/chat';
import type { LlmAssistantMessage } from '@kuroko/contracts/llm';
import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

type Row = ChatSummary & { revision: number; messagesJson: string; gmMode: 0 | 1; customTitle: string | null };
export type PrivateTurn = {
  notes?: string;
  rounds: { assistant: LlmAssistantMessage; calls: ChatToolCall[] }[];
};
type ReplyVersion = { message: ChatMessage; activity?: ChatActivityEntry[]; privateTurn?: PrivateTurn };

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
  const findPrivate = db.query<{ turnJson: string }, [string, number]>(`
    SELECT turn_json AS turnJson FROM chat_private_turns WHERE chat_id = ? AND reply_id = ?
  `);
  const findVariants = db.query<{ index: number; archivedJson: string }, [string, number]>(`
    SELECT selected_index AS "index", archived_json AS archivedJson FROM chat_reply_variants WHERE chat_id = ? AND reply_id = ?
  `);
  const listVariants = db.query<{ replyId: number; index: number; total: number }, [string]>(`
    SELECT reply_id AS replyId, selected_index AS "index", json_array_length(archived_json) + 1 AS total
    FROM chat_reply_variants WHERE chat_id = ?
  `);
  const upsertVariants = db.query(`
    INSERT INTO chat_reply_variants (chat_id, reply_id, selected_index, archived_json) VALUES (?, ?, ?, ?)
    ON CONFLICT (chat_id, reply_id) DO UPDATE SET selected_index = excluded.selected_index, archived_json = excluded.archived_json
  `);
  const deleteVariants = db.query('DELETE FROM chat_reply_variants WHERE chat_id = ? AND reply_id = ?');

  function withVariants(chat: SavedChat): SavedChat {
    const variants = listVariants.all(chat.id);
    return variants.length ? {
      ...chat, replyVariants: Object.fromEntries(variants.map(({ replyId, index, total }) => [replyId, { index, total }])),
    } : chat;
  }

  function withActivity(chat: SavedChat): SavedChat {
    const activity = listActivity.all(chat.id).map(({ promptId, entriesJson }) => ({
      promptId, entries: JSON.parse(entriesJson) as ChatActivityEntry[],
    }));
    return activity.length ? { ...chat, activity } : chat;
  }

  function readVariants(id: string, replyId: number) {
    const variants = findVariants.get(id, replyId);
    return variants && { index: variants.index, archived: JSON.parse(variants.archivedJson) as ReplyVersion[] };
  }

  function readVersion(id: string, message: ChatMessage, promptId?: number): ReplyVersion {
    const activity = promptId === undefined ? undefined : findActivity.get(id, promptId);
    const privateTurn = findPrivate.get(id, message.id);
    return {
      message,
      activity: activity ? JSON.parse(activity.entriesJson) as ChatActivityEntry[] : undefined,
      privateTurn: privateTurn ? JSON.parse(privateTurn.turnJson) as PrivateTurn : undefined,
    };
  }

  function clearReplyContext(id: string, replyId: number, promptId: number) {
    deleteActivity.run(id, promptId);
    deletePrivate.run(id, replyId, promptId);
  }

  function archiveReply(id: string, current: ChatMessage, nextId: number, promptId: number) {
    // The selected version lives in the active chat. The array holds the other versions in display order.
    const { index, archived } = readVariants(id, current.id) ?? { index: 0, archived: [] };
    archived.splice(index, 0, readVersion(id, current, promptId));
    if (current.id !== nextId) deleteVariants.run(id, current.id);
    upsertVariants.run(id, nextId, archived.length, JSON.stringify(archived));
    clearReplyContext(id, current.id, promptId);
  }

  function invalidateArchivedContext(id: string, replyId: number, promptDeleted: boolean) {
    const variants = readVariants(id, replyId);
    if (!variants) return;
    const archived = variants.archived.map(({ message, activity }) => ({ message, activity: promptDeleted ? undefined : activity }));
    upsertVariants.run(id, replyId, variants.index, JSON.stringify(archived));
  }

  const save = db.transaction((userId: number, id: string, { revision, messages, gmMode, activity, replaceId }: ChatSnapshot) => {
    const row = find.get(userId, id);
    if (!row) return 'missing';
    const messagesJson = JSON.stringify(messages);
    const mode = gmMode ?? Boolean(row.gmMode);
    const entriesJson = activity && JSON.stringify(activity.entries);
    if (row.revision === revision + 1 && row.messagesJson === messagesJson && mode === Boolean(row.gmMode) &&
        (!activity || findActivity.get(id, activity.promptId)?.entriesJson === entriesJson)) return withVariants(readChat(row));
    if (row.revision !== revision) return 'conflict';
    const firstPrompt = messages.find(({ role }) => role === 'user')?.text ?? '';
    const title = Array.from(firstPrompt.replace(/\s+/g, ' ').trim()).slice(0, chatTitleLimit).join('');
    const updatedAt = Date.now();
    if (replaceId !== undefined) {
      const previous = readChat(row).messages;
      const prompt = chatReplyPrompt(previous, replaceId);
      const reply = messages.at(-1);
      if (mode || !prompt || reply?.role !== 'assistant' || reply.id !== prompt.id + 1 || (activity && activity.promptId !== prompt.id) ||
          JSON.stringify(messages.slice(0, -1)) !== JSON.stringify(previous.slice(0, -1))) return 'conflict';
      archiveReply(id, previous.at(-1)!, reply.id, prompt.id);
    } else if (row.messagesJson !== messagesJson) {
      const current = new Map(messages.map((message, position) => [message.id, { message, position }]));
      const previousMessages = readChat(row).messages;
      for (const [position, previous] of previousMessages.entries()) {
        const next = current.get(previous.id);
        const removed = next?.message.role !== previous.role;
        if (removed || next.message.text !== previous.text) {
          deletePrivate.run(id, previous.id, previous.id);
          const reply = previousMessages[position + 1];
          if (!removed && previous.role === 'user' && reply?.role === 'assistant') invalidateArchivedContext(id, reply.id, false);
        }
        if (previous.role === 'user') {
          if (removed) deleteActivity.run(id, previous.id);
          continue;
        }
        const oldPrompt = previousMessages[position - 1];
        const newPrompt = next && messages[next.position - 1];
        if (!removed && oldPrompt?.id === newPrompt?.id && oldPrompt?.role === newPrompt?.role) continue;
        if (oldPrompt?.role === 'user') clearReplyContext(id, previous.id, oldPrompt.id);
        if (removed) deleteVariants.run(id, previous.id);
        else invalidateArchivedContext(id, previous.id, true);
      }
    }
    update.run(title, updatedAt, messagesJson, Number(mode), userId, id);
    if (activity && entriesJson) insertActivity.run(id, activity.promptId, entriesJson);
    return withVariants({ id, title: row.customTitle ?? title, updatedAt, revision: revision + 1, messages, gmMode: mode });
  });

  const publish = db.transaction((
    userId: number, id: string, revision: number, text: string, turn: PrivateTurn,
    { replaceId, instruction }: { replaceId?: number; instruction?: ChatActivityEntry },
  ) => {
    const row = find.get(userId, id);
    if (!row) return 'missing';
    if (row.revision !== revision || !row.gmMode) return 'conflict';
    const chat = readChat(row);
    const prompt = chatReplyPrompt(chat.messages, replaceId);
    if (!prompt) return 'conflict';
    const reply: ChatMessage = { id: prompt.id + 1, role: 'assistant', text, time: Date.now() };
    if (replaceId !== undefined) {
      archiveReply(id, chat.messages.pop()!, reply.id, prompt.id);
    }
    chat.messages.push(reply);
    update.run(row.title, reply.time, JSON.stringify(chat.messages), row.gmMode, userId, id);
    if (instruction) insertActivity.run(id, prompt.id, JSON.stringify([instruction]));
    else deleteActivity.run(id, prompt.id);
    insertPrivate.run(id, reply.id, prompt.id, JSON.stringify(turn));
    return withActivity(withVariants({ ...chat, revision: revision + 1, updatedAt: reply.time }));
  });

  const selectVariant = db.transaction((userId: number, id: string, revision: number, { replyId, index }: ChatReplyVariantSelection) => {
    const row = find.get(userId, id);
    if (!row) return 'missing';
    const chat = readChat(row);
    const position = chat.messages.findIndex((message) => message.id === replyId && message.role === 'assistant');
    const prompt = chat.messages[position - 1];
    const promptId = prompt?.role === 'user' ? prompt.id : undefined;
    const variants = readVariants(id, replyId);
    if (position === -1 || !variants || index > variants.archived.length) return 'conflict';
    if (variants.index === index && (row.revision === revision || row.revision === revision + 1)) {
      return withActivity(withVariants(chat));
    }
    if (row.revision !== revision) return 'conflict';

    const { archived } = variants;
    archived.splice(variants.index, 0, readVersion(id, chat.messages[position]!, promptId));
    const [selected] = archived.splice(index, 1);
    const { message, activity, privateTurn } = selected!;
    chat.messages[position] = { ...message, id: replyId };
    if (promptId !== undefined) {
      clearReplyContext(id, replyId, promptId);
      if (activity) insertActivity.run(id, promptId, JSON.stringify(activity));
      if (privateTurn) insertPrivate.run(id, replyId, promptId, JSON.stringify(privateTurn));
    }
    upsertVariants.run(id, replyId, index, JSON.stringify(archived));
    const updatedAt = Date.now();
    update.run(row.title, updatedAt, JSON.stringify(chat.messages), row.gmMode, userId, id);
    return withActivity(withVariants({ ...chat, revision: revision + 1, updatedAt }));
  });

  return {
    list: (userId: number) => list.all(userId),
    find(userId: number, id: string) {
      const row = find.get(userId, id);
      return row && readChat(row);
    },
    open: db.transaction((userId: number, id: string) => {
      const row = find.get(userId, id);
      if (row) return withActivity(withVariants(readChat(row)));
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
    selectVariant: selectVariant.immediate,
    privateTurns: (userId: number, id: string) => listPrivate.all(userId, id)
      .map(({ replyId, turnJson }) => ({ replyId, turn: JSON.parse(turnJson) as PrivateTurn })),
  };
}

function readChat({ messagesJson, gmMode, customTitle, ...row }: Row): SavedChat {
  return { ...row, title: customTitle ?? row.title, gmMode: Boolean(gmMode), messages: JSON.parse(messagesJson) as ChatMessage[] };
}
