import type { MessageKey } from '../../shared/i18n/i18n';
import { combine, createEffect, createEvent, createStore, sample, scopeBind, type StoreValue } from 'effector';
import { abortFx } from '../../shared/async/abort';
import { errorCode, type ErrorCode } from '../../shared/http/api';
import { $activeSession, protectedRequestFailed, sessionEnded, type ActiveSession } from '../../platform/session/model';
import { inActiveSession } from '../../platform/session/request';
import { streamChatReply } from './chatApi';
import type { Message } from './message';

type Generation = { session: ActiveSession; controller: AbortController };
type Reply = { generation: Generation; message: Message };

export const chatShown = createEvent();
export const chatHidden = createEvent();
export const chatDraftChanged = createEvent<string>();
export const chatSendRequested = createEvent();
export const chatStopRequested = createEvent();
export const messageEditRequested = createEvent<number>();
export const messageEditChanged = createEvent<{ id: number; text: string }>();
export const messageEditCancelled = createEvent();
export const messageEditSubmitted = createEvent<number>();
export const messageDeleteRequested = createEvent<number>();
export const reasoningToggled = createEvent<{ id: number; open: boolean }>();

const $visible = createStore(false).on(chatShown, () => true).reset(chatHidden, sessionEnded);
const $messages = createStore<Message[]>([]).reset(sessionEnded);
const $reply = createStore<Reply | null>(null).reset(sessionEnded);
const $nextId = createStore(1).reset(sessionEnded);

export const $chatDraft = createStore('').on(chatDraftChanged, (_, draft) => draft).reset(sessionEnded);

const $composer = combine({
  session: $activeSession, visible: $visible, draft: $chatDraft, reply: $reply, nextId: $nextId,
});
function canSend({ session, visible, draft, reply }: StoreValue<typeof $composer>) {
  return session !== null && visible && reply === null && Boolean(draft.trim());
}

export const $chatCanSend = $composer.map(canSend);
export const messageSent = sample({
  clock: chatSendRequested,
  source: $composer,
  filter: canSend,
  fn: ({ session, nextId, draft }) => {
    const time = Date.now();
    const user: Message = { id: nextId, role: 'user', text: draft.trim(), time };
    const reply: Reply = {
      generation: { session: session!, controller: new AbortController() },
      message: { id: nextId + 1, role: 'assistant', text: '', time },
    };
    return { user, reply };
  },
});
$messages.on(messageSent, (messages, { user }) => [...messages, user]);
$reply.on(messageSent, (_, { reply }) => reply);
$nextId.on(messageSent, (_, { reply }) => reply.message.id + 1);
$chatDraft.reset(messageSent);

const replyDelta = createEvent<{ generation: Generation; text: string }>();
const streamReplyFx = createEffect(({ generation, text }: { generation: Generation; text: string }) => {
  const publish = scopeBind(replyDelta, { safe: true });
  return streamChatReply(generation.session, text, generation.controller.signal, (delta) => publish({ generation, text: delta }));
});

sample({
  clock: messageSent,
  fn: ({ reply, user }) => ({ generation: reply.generation, text: user.text }),
  target: streamReplyFx,
});

const replyUpdated = sample({
  clock: replyDelta,
  source: $reply,
  filter: (reply, { generation, text }) => reply?.generation === generation && Boolean(text),
  fn: (reply, { text }): Reply => ({ ...reply!, message: { ...reply!.message, text: reply!.message.text + text } }),
});
$reply.on(replyUpdated, (_, reply) => reply);

const replyCompleted = sample({
  clock: inActiveSession(streamReplyFx.done, ({ generation }) => generation.session),
  source: $reply,
  filter: (reply, { params }) => reply?.generation === params.generation,
  fn: (reply, { result }) => ({ message: { ...reply!.message, text: result } }),
});
const replyFailed = sample({
  clock: inActiveSession(streamReplyFx.fail, ({ generation }) => generation.session),
  source: $reply,
  filter: (reply, { params }) => reply?.generation === params.generation,
  fn: (reply, { error, params }) => ({ message: reply!.message, error, session: params.generation.session }),
});
sample({ clock: replyFailed, fn: ({ session, error }) => ({ session, error }), target: protectedRequestFailed });

const replyStopped = sample({
  clock: [chatStopRequested, chatHidden],
  source: $reply,
  filter: (reply): reply is Reply => reply !== null,
  fn: (reply) => ({ message: reply!.message, controller: reply!.generation.controller }),
});

sample({ clock: replyStopped, fn: ({ controller }) => controller, target: abortFx });
$reply.reset(replyCompleted, replyFailed, replyStopped);
$messages.on([replyCompleted, replyFailed, replyStopped], (messages, { message }) => message.text ? [...messages, message] : messages);

export const $chatError = createStore<ErrorCode | null>(null)
  .on(replyFailed, (_, { error }) => errorCode(error))
  .reset(messageSent, sessionEnded);

type Editor = { id: number; text: string };
const editOpened = sample({
  clock: messageEditRequested,
  source: $messages,
  fn: (messages, id) => messages.find((message) => message.id === id),
}).filterMap((message) => message && { id: message.id, text: message.text });

const $editor = createStore<Editor | null>(null)
  .on(editOpened, (editor, draft) => editor?.id === draft.id ? editor : draft)
  .on(messageEditChanged, (editor, draft) => editor?.id === draft.id ? draft : editor)
  .reset(messageEditCancelled, sessionEnded);

export const $messageEditor = combine($editor, $messages, (editor, messages) => {
  if (!editor) return null;
  const original = messages.find((message) => message.id === editor.id);
  const text = editor.text.trim();
  return { ...editor, canSave: Boolean(original && (text || original.image) && text !== original.text) };
});
const messageEdited = sample({
  clock: messageEditSubmitted,
  source: $messageEditor,
  filter: (editor, id) => editor?.id === id && editor.canSave,
  fn: (editor) => ({ id: editor!.id, text: editor!.text.trim() }),
});

const messageDeleted = sample({
  clock: messageDeleteRequested,
  source: $messages,
  filter: (messages, id) => messages.some((message) => message.id === id),
  fn: (_, id) => id,
});

$messages
  .on(messageEdited, (messages, { id, text }) => messages.map((message) => message.id === id ? { ...message, text, edited: true } : message))
  .on(messageDeleted, (messages, id) => messages.filter((message) => message.id !== id));
$editor
  .reset(messageEdited)
  .on(messageDeleted, (editor, id) => editor?.id === id ? null : editor);

export const $expandedReasoning = createStore<ReadonlySet<number>>(new Set())
  .on(reasoningToggled, (expanded, { id, open }) => {
    if (expanded.has(id) === open) return expanded;
    const next = new Set(expanded);
    if (open) next.add(id);
    else next.delete(id);
    return next;
  })
  .on(messageDeleted, (expanded, id) => {
    if (!expanded.has(id)) return expanded;
    const next = new Set(expanded);
    next.delete(id);
    return next;
  })
  .reset(sessionEnded);

export const $chatAnnouncement = createStore<MessageKey | null>(null)
  .on(messageSent, () => 'chat.announcementAnswering')
  .on(replyCompleted, () => 'chat.announcementReady')
  .reset(replyFailed)
  .on(replyStopped, () => 'chat.announcementStopped')
  .on(messageEdited, () => 'chat.announcementEdited')
  .on(messageDeleted, () => 'chat.announcementDeleted')
  .reset(sessionEnded);

export const $replyId = $reply.map((reply) => reply?.message.id ?? null);
export const $chatRows = combine($messages, $reply, (messages, reply) => reply ? [...messages, reply.message] : messages);
export const keepHistoryAtEndRequested = sample({
  clock: [replyUpdated, replyCompleted, replyFailed, replyStopped, messageEdited], fn: () => undefined,
});
