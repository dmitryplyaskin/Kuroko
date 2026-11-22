import type { MessageKey } from '../../shared/i18n/i18n';
import { combine, createEffect, createEvent, createStore, sample, scopeBind, type StoreValue } from 'effector';
import type { ChatSnapshot, ChatSummary, ChatToolCall, SavedChat } from '@kuroko/contracts/chat';
import type { ToolId } from '@kuroko/contracts/tools';
import { abortFx } from '../../shared/async/abort';
import { errorCode, type ErrorCode } from '../../shared/http/api';
import { $activeSession, protectedRequestFailed, sessionEnded, type ActiveSession } from '../../platform/session/model';
import { inActiveSession } from '../../platform/session/request';
import { $enabledTools, $toolSettingsBusy } from '../tools/model';
import { chatApi, streamChatReply } from './chatApi';
import { editMessageText, hasMessageContent, type ActiveSubagent, type Message, type ReplyPhase } from './message';

type Generation = { session: ActiveSession; controller: AbortController; enabledTools: readonly ToolId[] };
type Reply = { generation: Generation; message: Message; activeSubagents?: readonly ActiveSubagent[] };
type Navigation = { session: ActiveSession; action: 'initial' | 'create' | 'open'; id?: string };
type Save = ChatSnapshot & { session: ActiveSession; id: string; reply?: Reply };

export const chatShown = createEvent();
export const chatHidden = createEvent();
export const chatDraftChanged = createEvent<string>();
export const chatSendRequested = createEvent();
export const chatStopRequested = createEvent();
export const chatCreateRequested = createEvent();
export const chatOpenRequested = createEvent<string>();
export const chatLoadRetryRequested = createEvent();
export const chatSaveRetryRequested = createEvent();
export const chatGmModeChanged = createEvent<boolean>();
export const messageEditRequested = createEvent<number>();
export const messageEditChanged = createEvent<{ id: number; text: string }>();
export const messageEditCancelled = createEvent();
export const messageEditSubmitted = createEvent<number>();
export const messageDeleteRequested = createEvent<number>();
export const reasoningToggled = createEvent<{ id: number; open: boolean }>();

const $visible = createStore(false).on(chatShown, () => true).reset(chatHidden, sessionEnded);
const navigateFx = createEffect(async ({ session, action, id }: Navigation) => {
  if (action === 'create') return { chat: await chatApi.create(session) };
  if (action === 'open' && id) return { chat: await chatApi.open(session, id) };
  const chats = await chatApi.list(session);
  const chat = chats[0] ? await chatApi.open(session, chats[0].id) : await chatApi.create(session);
  return { chat, chats };
});
const saveChatFx = createEffect(({ session, id, revision, messages, gmMode }: Save) =>
  chatApi.save(session, id, { revision, messages, gmMode }));
const chatOpened = inActiveSession(navigateFx.done, ({ session }) => session);
const openFailed = inActiveSession(navigateFx.fail, ({ session }) => session);
const saveSucceeded = inActiveSession(saveChatFx.done, ({ session }) => session);
const saveFailed = inActiveSession(saveChatFx.fail, ({ session }) => session);

const $saved = createStore<SavedChat | null>(null)
  .on(chatOpened, (_, { result }) => result.chat)
  .on(saveSucceeded, (_, { result }) => result)
  .reset(sessionEnded);
export const $chatId = $saved.map((chat) => chat?.id ?? '');
export const $chatGmMode = $saved.map((chat) => chat?.gmMode ?? false);
export const $chats = createStore<ChatSummary[]>([])
  .on(chatOpened, (chats, { result }) => updateChatList(result.chats ?? chats, result.chat))
  .on(saveSucceeded, (chats, { result }) => updateChatList(chats, result))
  .reset(sessionEnded);

function updateChatList(chats: ChatSummary[], { id, title, updatedAt }: ChatSummary) {
  return [{ id, title, updatedAt }, ...chats.filter((chat) => chat.id !== id)]
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

const $loadError = createStore<{ code: ErrorCode; params: Navigation } | null>(null)
  .on(openFailed, (_, { params, error }) => ({ params, code: errorCode(error) }))
  .reset(navigateFx, sessionEnded);
const $saveError = createStore<{ code: ErrorCode; params: Save } | null>(null)
  .on(saveFailed, (_, { params, error }) => ({ params, code: errorCode(error) }))
  .reset(saveChatFx, chatOpened, sessionEnded);

sample({ clock: [openFailed, saveFailed], fn: ({ params, error }) => ({ session: params.session, error }), target: protectedRequestFailed });

export const $chatLoadError = $loadError.map((failure) => failure?.code ?? null);
export const $chatSaveError = $saveError.map((failure) => failure?.code ?? null);
export const $chatLoading = createStore(false).on(navigateFx, () => true).reset(chatOpened, openFailed, sessionEnded);
const $saving = createStore(false).on(saveChatFx, () => true).reset(saveSucceeded, saveFailed, sessionEnded);

const $navigation = combine({ session: $activeSession, busy: $chatLoading, current: $chatId });
sample({
  clock: chatShown,
  source: $navigation,
  filter: ({ session, busy, current }) => session !== null && !busy && !current,
  fn: ({ session }): Navigation => ({ session: session!, action: 'initial' }),
  target: navigateFx,
});
sample({
  clock: chatLoadRetryRequested,
  source: $loadError,
  filter: (failure) => failure !== null,
  fn: (failure) => failure!.params,
  target: navigateFx,
});
sample({
  clock: chatSaveRetryRequested,
  source: $saveError,
  filter: (failure) => failure !== null && failure.code !== 'chat_conflict',
  fn: (failure) => failure!.params,
  target: saveChatFx,
});
sample({
  clock: chatSaveRetryRequested,
  source: $saveError,
  filter: (failure) => failure?.code === 'chat_conflict',
  fn: (failure): Navigation => ({ session: failure!.params.session, action: 'open', id: failure!.params.id }),
  target: navigateFx,
});

const $messages = createStore<Message[]>([]).reset(sessionEnded);
const $reply = createStore<Reply | null>(null).reset(sessionEnded);
const $nextId = createStore(1)
  .on(chatOpened, (_, { result }) => (result.chat.messages.at(-1)?.id ?? 0) + 1)
  .reset(sessionEnded);
$messages.on(chatOpened, (_, { result }) => result.chat.messages);

export const $chatLocked = combine($chatLoading, $saving, $saveError, $reply,
  (loading, saving, failure, reply) => loading || saving || failure !== null || reply !== null);

const $chatNavigation = combine($navigation, $chatLocked, (navigation, locked) => ({ ...navigation, locked }));
sample({
  clock: chatCreateRequested,
  source: $chatNavigation,
  filter: ({ session, locked }) => session !== null && !locked,
  fn: ({ session }): Navigation => ({ session: session!, action: 'create' }),
  target: navigateFx,
});
sample({
  clock: chatOpenRequested,
  source: $chatNavigation,
  filter: ({ session, locked, current }, id) => session !== null && !locked && id !== current,
  fn: ({ session }, id): Navigation => ({ session: session!, action: 'open', id }),
  target: navigateFx,
});

export const $chatDraft = createStore('').on(chatDraftChanged, (_, draft) => draft).reset(chatOpened, sessionEnded);

const $composer = combine({
  session: $activeSession, visible: $visible, draft: $chatDraft, locked: $chatLocked, chatId: $chatId, nextId: $nextId,
  enabledTools: $enabledTools, toolSettingsBusy: $toolSettingsBusy,
});
function canSend({ session, visible, draft, locked, chatId, toolSettingsBusy }: StoreValue<typeof $composer>) {
  return session !== null && visible && !locked && !toolSettingsBusy && Boolean(chatId && draft.trim());
}

export const $chatCanSend = $composer.map(canSend);
export const messageSent = sample({
  clock: chatSendRequested,
  source: $composer,
  filter: canSend,
  fn: ({ session, nextId, draft, enabledTools }) => {
    const time = Date.now();
    const user: Message = { id: nextId, role: 'user', text: draft.trim(), time };
    const reply: Reply = {
      generation: { session: session!, controller: new AbortController(), enabledTools },
      message: { id: nextId + 1, role: 'assistant', text: '', time },
    };
    return { user, reply };
  },
});
$messages.on(messageSent, (messages, { user }) => [...messages, user]);
$nextId.on(messageSent, (_, { reply }) => reply.message.id + 1);
$chatDraft.reset(messageSent);

const replyDelta = createEvent<{ generation: Generation; text: string }>();
const replyContentReceived = createEvent<{ generation: Generation; text: string; toolCalls: ChatToolCall[] }>();
const replySubagentActivity = createEvent<{ generation: Generation; active: readonly ActiveSubagent[] }>();
const generateReplyFx = createEffect(async ({ reply: { generation }, chat }: { reply: Reply; chat: SavedChat }) => {
  if (chat.gmMode) return chatApi.gmReply(generation.session, chat, generation.controller.signal);
  const publish = scopeBind(replyDelta, { safe: true });
  const report = scopeBind(replyContentReceived, { safe: true });
  const reportSubagent = scopeBind(replySubagentActivity, { safe: true });
  return streamChatReply(generation.session, chat.messages, generation.enabledTools, generation.controller.signal,
    (delta) => publish({ generation, text: delta }), (text, toolCalls) => report({ generation, text, toolCalls }),
    (active) => reportSubagent({ generation, active }));
});

const replyContentUpdated = sample({
  clock: replyContentReceived,
  source: $reply,
  filter: (reply, { generation }) => reply?.generation === generation,
  fn: (reply, { text, toolCalls }): Reply => ({
    ...reply!, message: { ...reply!.message, text, toolCalls: toolCalls.length ? toolCalls : undefined },
  }),
});
$reply.on(replyContentUpdated, (_, reply) => reply);

const replySubagentUpdated = sample({
  clock: replySubagentActivity,
  source: $reply,
  filter: (reply, { generation }) => reply?.generation === generation,
  fn: (reply, { active }): Reply => ({ ...reply!, activeSubagents: active }),
});
$reply.on(replySubagentUpdated, (_, reply) => reply);

const replyPrepared = saveSucceeded.filterMap(({ params, result }) => params.reply && { reply: params.reply, chat: result });
sample({
  clock: replyPrepared,
  filter: $visible,
  target: generateReplyFx,
});
$reply.on(generateReplyFx, (_, { reply }) => reply);

const replyUpdated = sample({
  clock: replyDelta,
  source: $reply,
  filter: (reply, { generation, text }) => reply?.generation === generation && Boolean(text),
  fn: (reply, { text }): Reply => ({ ...reply!, message: { ...reply!.message, text: reply!.message.text + text } }),
});
$reply.on(replyUpdated, (_, reply) => reply);

const replyCompleted = sample({
  clock: inActiveSession(generateReplyFx.done, ({ reply }) => reply.generation.session),
  source: $reply,
  filter: (reply, { params }) => reply?.generation === params.reply.generation,
  fn: (reply, { result }) => typeof result === 'string'
    ? {
      message: { ...reply!.message, text: result },
      noToolsCalled: Boolean(reply!.generation.enabledTools.length && !reply!.message.toolCalls?.length),
      saved: null,
    }
    : { message: result.messages.at(-1)!, noToolsCalled: false, saved: result },
});
const replyFailed = sample({
  clock: inActiveSession(generateReplyFx.fail, ({ reply }) => reply.generation.session),
  source: $reply,
  filter: (reply, { params }) => reply?.generation === params.reply.generation,
  fn: (reply, { error, params }) => ({ message: reply!.message, error, session: params.reply.generation.session }),
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
$messages
  .on(replyCompleted, (messages, { message, saved }) => {
    if (saved) return saved.messages;
    return hasMessageContent(message) ? [...messages, message] : messages;
  })
  .on([replyFailed, replyStopped], (messages, { message }) => hasMessageContent(message) ? [...messages, message] : messages);
$saved.on(replyCompleted, (chat, { saved }) => saved ?? chat);
$chats.on(replyCompleted, (chats, { saved }) => saved ? updateChatList(chats, saved) : chats);

export const $chatNoToolsCalled = createStore(false)
  .on(replyCompleted, (_, { noToolsCalled }) => noToolsCalled)
  .reset(messageSent, chatOpened, sessionEnded);

export const $chatError = createStore<ErrorCode | null>(null)
  .on(replyFailed, (_, { error }) => errorCode(error))
  .reset(messageSent, chatOpened, sessionEnded);

type Editor = { id: number; text: string };
const editOpened = sample({
  clock: messageEditRequested,
  source: $messages,
  filter: $chatLocked.map((locked) => !locked),
  fn: (messages, id) => messages.find((message) => message.id === id),
}).filterMap((message) => message && { id: message.id, text: message.text });

const $editor = createStore<Editor | null>(null)
  .on(editOpened, (editor, draft) => editor?.id === draft.id ? editor : draft)
  .on(messageEditChanged, (editor, draft) => editor?.id === draft.id ? draft : editor)
  .reset(messageEditCancelled, chatOpened, sessionEnded);

export const $messageEditor = combine($editor, $messages, $chatLocked, (editor, messages, locked) => {
  if (!editor) return null;
  const original = messages.find((message) => message.id === editor.id);
  const text = editor.text.trim();
  return { ...editor, canSave: Boolean(!locked && original && (text || original.image) && text !== original.text) };
});
const messageEdited = sample({
  clock: messageEditSubmitted,
  source: $messageEditor,
  filter: (editor, id) => editor?.id === id && editor.canSave,
  fn: (editor) => ({ id: editor!.id, text: editor!.text.trim() }),
});

const messageDeleted = sample({
  clock: messageDeleteRequested,
  source: { messages: $messages, locked: $chatLocked },
  filter: ({ messages, locked }, id) => !locked && messages.some((message) => message.id === id),
  fn: (_, id) => id,
});

$messages
  .on(messageEdited, (messages, { id, text }) => messages.map((message) => message.id === id ? editMessageText(message, text) : message))
  .on(messageDeleted, (messages, id) => messages.filter((message) => message.id !== id));
$editor
  .reset(messageEdited)
  .on(messageDeleted, (editor, id) => editor?.id === id ? null : editor);

const historyChanged = createEvent<{ reply?: Reply; gmMode?: boolean }>();
sample({ clock: messageSent, fn: ({ reply }) => ({ reply }), target: historyChanged });
sample({ clock: [messageEdited, messageDeleted], fn: () => ({}), target: historyChanged });
sample({
  clock: chatGmModeChanged,
  source: { locked: $chatLocked, chat: $saved },
  filter: ({ locked, chat }, gmMode) => !locked && chat !== null && chat.gmMode !== gmMode,
  fn: (_, gmMode) => ({ gmMode }),
  target: historyChanged,
});
sample({
  clock: [replyCompleted.filter({ fn: ({ saved }) => !saved }), replyFailed, replyStopped],
  filter: ({ message }) => hasMessageContent(message),
  fn: () => ({}),
  target: historyChanged,
});
sample({
  clock: historyChanged,
  source: { session: $activeSession, chat: $saved, messages: $messages },
  filter: ({ session, chat }) => session !== null && chat !== null,
  fn: ({ session, chat, messages }, { reply, gmMode }): Save =>
    ({ session: session!, id: chat!.id, revision: chat!.revision, messages, reply, gmMode }),
  target: saveChatFx,
});

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
  .reset(chatOpened, sessionEnded);

export const $chatAnnouncement = createStore<MessageKey | null>(null)
  .on(generateReplyFx, () => 'chat.announcementAnswering')
  .on(replySubagentUpdated, (_, { activeSubagents }) => {
    const count = activeSubagents?.length ?? 0;
    if (count > 1) return 'chat.subagentsWorking';
    return count ? 'chat.subagentWorking' : 'chat.announcementAnswering';
  })
  .on(replyCompleted, () => 'chat.announcementReady')
  .reset(replyFailed)
  .on(replyStopped, () => 'chat.announcementStopped')
  .on(messageEdited, () => 'chat.announcementEdited')
  .on(messageDeleted, () => 'chat.announcementDeleted')
  .reset(chatOpened, sessionEnded);

export const $replyId = $reply.map((reply) => reply?.message.id ?? null);
export const $replyPhase = $reply.map((reply): ReplyPhase | null => {
  if (!reply) return null;
  return reply.activeSubagents?.length ? 'subagent' : 'answer';
});
const noSubagents: readonly ActiveSubagent[] = [];
export const $activeSubagents = $reply.map((reply) => reply?.activeSubagents ?? noSubagents);
export const $chatRows = combine($messages, $reply, (messages, reply) => reply ? [...messages, reply.message] : messages);
export const keepHistoryAtEndRequested = sample({
  clock: [replyUpdated, replyContentUpdated, replySubagentUpdated, replyCompleted, replyFailed, replyStopped, messageEdited],
  fn: () => undefined,
});
