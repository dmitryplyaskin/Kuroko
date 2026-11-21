import { combine, createEffect, createEvent, createStore, sample, type StoreValue } from 'effector';
import { abortFx } from '../../shared/async/abort';
import { $activeSession, sessionEnded, type ActiveSession } from '../../platform/session/model';
import type { ChatImage, Message, ReplyPhase } from './message';
import { createMockHistory, getMockReply } from './mock';

type Visibility = { session: ActiveSession; controller: AbortController };
type Reply = {
  message: Message & { reasoning: string };
  phase: ReplyPhase;
  visible: number;
  controller: AbortController;
};

export const chatShown = createEvent();
export const chatHidden = createEvent();
export const chatDraftChanged = createEvent<string>();
export const chatAttachmentSelected = createEvent<File>();
export const chatAttachmentRemoved = createEvent();
export const chatSendRequested = createEvent();
export const chatStopRequested = createEvent();
export const messageEditRequested = createEvent<number>();
export const messageEditChanged = createEvent<{ id: number; text: string }>();
export const messageEditCancelled = createEvent();
export const messageEditSubmitted = createEvent<number>();
export const messageDeleteRequested = createEvent<number>();
export const reasoningToggled = createEvent<{ id: number; open: boolean }>();

const $visibility = createStore<Visibility | null>(null);
const chatActivated = sample({
  clock: chatShown,
  source: { session: $activeSession, visibility: $visibility },
  filter: ({ session, visibility }) => session !== null && visibility === null,
  fn: ({ session }): Visibility => ({ session: session!, controller: new AbortController() }),
});
$visibility.on(chatActivated, (_, visibility) => visibility);
const chatDeactivated = sample({
  clock: [chatHidden, sessionEnded],
  source: $visibility,
  filter: (visibility): visibility is Visibility => visibility !== null,
});
$visibility.reset(chatDeactivated);
sample({ clock: chatDeactivated, fn: (visibility) => visibility.controller, target: abortFx });

const loadHistoryFx = createEffect((session: ActiveSession) => ({ session, messages: createMockHistory() }));
const historyLoaded = sample({
  clock: loadHistoryFx.doneData,
  source: $activeSession,
  filter: (session, result) => session === result.session,
  fn: (_, result) => result.messages,
});
export const $chatInitialized = createStore(false).on(historyLoaded, () => true).reset(sessionEnded);

sample({
  clock: chatActivated,
  filter: combine($chatInitialized, loadHistoryFx.pending, (initialized, pending) => !initialized && !pending),
  fn: ({ session }) => session,
  target: loadHistoryFx,
});

const $messages = createStore<Message[]>([]).on(historyLoaded, (_, messages) => messages).reset(sessionEnded);
const $reply = createStore<Reply | null>(null).reset(sessionEnded);
const $nextId = createStore(1).on(historyLoaded, (_, messages) => (messages.at(-1)?.id ?? 0) + 1).reset(sessionEnded);

const attachmentChecked = chatAttachmentSelected.map((file) => ({
  file, valid: file.type.startsWith('image/') && file.size <= 10 * 1024 * 1024,
}));
const attachmentAccepted = attachmentChecked.filterMap(({ file, valid }) => valid ? file : undefined);

export const $chatDraft = createStore('').on(chatDraftChanged, (_, draft) => draft).reset(sessionEnded);
export const $chatAttachment = createStore<File | null>(null)
  .on(attachmentAccepted, (_, file) => file)
  .reset(chatAttachmentRemoved, sessionEnded);
export const $chatAttachmentError = createStore('')
  .on(attachmentChecked, (_, { valid }) => valid ? '' : 'Выберите изображение размером до 10 МБ.')
  .reset(chatAttachmentRemoved, sessionEnded);

const createMessagesFx = createEffect(({ session, nextId, text, file }: {
  session: ActiveSession; nextId: number; text: string; file: File | null;
}) => {
  const image: ChatImage | undefined = file ? { file } : undefined;
  const time = Date.now();
  const user: Message = { id: nextId, role: 'user', text, time, image };
  const reply: Reply = {
    message: { ...getMockReply(user), id: nextId + 1, role: 'assistant', time },
    phase: 'reasoning', visible: 0, controller: new AbortController(),
  };
  return { session, user, reply };
});

const $composer = combine({
  initialized: $chatInitialized, visibility: $visibility, draft: $chatDraft, file: $chatAttachment,
  reply: $reply, pending: createMessagesFx.pending, nextId: $nextId,
});
function canSend({ initialized, visibility, draft, file, reply, pending }: StoreValue<typeof $composer>) {
  return initialized && visibility !== null && !reply && !pending && Boolean(draft.trim() || file);
}

export const $chatCanSend = $composer.map(canSend);
sample({
  clock: chatSendRequested,
  source: $composer,
  filter: canSend,
  fn: ({ visibility, nextId, draft, file }) => ({ session: visibility!.session, nextId, text: draft.trim(), file }),
  target: createMessagesFx,
});

export const messageSent = sample({
  clock: createMessagesFx.doneData,
  source: $activeSession,
  filter: (session, result) => session === result.session,
  fn: (_, { user, reply }) => ({ user, reply }),
});
$messages.on(messageSent, (messages, { user }) => [...messages, user]);
$reply.on(messageSent, (_, { reply }) => reply);
$nextId.on(messageSent, (_, { reply }) => reply.message.id + 1);
$chatDraft.reset(messageSent);
$chatAttachment.reset(messageSent);
$chatAttachmentError.reset(messageSent);

function partialReply({ message, phase, visible }: Reply): Message {
  return {
    ...message,
    reasoning: phase === 'reasoning' ? message.reasoning.slice(0, visible) : message.reasoning,
    text: phase === 'answer' ? message.text.slice(0, visible) : '',
    image: undefined,
  };
}

type Tick = { visibility: Visibility; reply: Reply };
export const waitForReplyTickFx = createEffect(({ visibility, reply }: Tick) => {
  const signal = AbortSignal.any([visibility.controller.signal, reply.controller.signal, visibility.session.signal]);
  const delay = reply.phase === 'reasoning' && reply.visible === 0 ? 350 : 75;
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, delay);
    signal.addEventListener('abort', finish, { once: true });
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
});

const $tick = combine({ visibility: $visibility, reply: $reply });
sample({
  clock: [chatActivated, $reply.updates],
  source: $tick,
  filter: ({ visibility, reply }) => visibility !== null && reply !== null,
  fn: ({ visibility, reply }): Tick => ({ visibility: visibility!, reply: reply! }),
  target: waitForReplyTickFx,
});

const tickElapsed = sample({
  clock: waitForReplyTickFx.done,
  source: $tick,
  filter: ({ visibility, reply }, { params }) => visibility === params.visibility && reply === params.reply,
  fn: (_, { params }) => params.reply,
});
const replyAdvanced = tickElapsed.map((reply) => {
  const thinking = reply.phase === 'reasoning';
  const visible = reply.visible + (thinking ? 24 : 18);
  const content = thinking ? reply.message.reasoning : reply.message.text;
  if (visible < content.length) return { reply: { ...reply, visible } };
  if (thinking) return { reply: { ...reply, phase: 'answer' as const, visible: 0 }, announcement: 'Модель отвечает.' };
  return { reply: null, completed: reply.message, announcement: 'Ответ модели готов.' };
});

const replyStopped = sample({
  clock: chatStopRequested,
  source: $reply,
  filter: (reply): reply is Reply => reply !== null,
  fn: (reply) => {
    const partial = partialReply(reply!);
    return { partial, discarded: !partial.text && !partial.reasoning, controller: reply!.controller };
  },
});

sample({ clock: replyStopped, fn: ({ controller }) => controller, target: abortFx });
$reply.on(replyAdvanced, (_, { reply }) => reply).reset(replyStopped);
$messages
  .on(replyAdvanced, (messages, { completed }) => completed ? [...messages, completed] : messages)
  .on(replyStopped, (messages, { partial, discarded }) => discarded ? messages : [...messages, partial]);

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

const reasoningCleared = replyStopped.filterMap(({ partial, discarded }) => discarded ? partial.id : undefined);
export const $expandedReasoning = createStore<ReadonlySet<number>>(new Set())
  .on(reasoningToggled, (expanded, { id, open }) => {
    if (expanded.has(id) === open) return expanded;
    const next = new Set(expanded);
    if (open) next.add(id);
    else next.delete(id);
    return next;
  })
  .on([reasoningCleared, messageDeleted], (expanded, id) => {
    if (!expanded.has(id)) return expanded;
    const next = new Set(expanded);
    next.delete(id);
    return next;
  })
  .reset(sessionEnded);

export const $chatAnnouncement = createStore('')
  .on(messageSent, () => 'Модель рассуждает.')
  .on(replyAdvanced, (current, { announcement }) => announcement ?? current)
  .on(replyStopped, () => 'Ответ модели остановлен.')
  .on(messageEdited, () => 'Сообщение изменено.')
  .on(messageDeleted, () => 'Сообщение удалено.')
  .reset(sessionEnded);

export const $replyId = $reply.map((reply) => reply?.message.id ?? null);
export const $replyPhase = $reply.map((reply) => reply?.phase ?? null);
export const $chatRows = combine($messages, $reply, (messages, reply) => reply ? [...messages, partialReply(reply)] : messages);
export const keepHistoryAtEndRequested = sample({ clock: [tickElapsed, replyStopped, messageEdited], fn: () => undefined });
